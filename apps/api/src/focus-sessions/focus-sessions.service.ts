import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type FocusSession, type FocusSessionPause } from '@prisma/client';
import {
  effectiveMs,
  sumPauseMs,
  type FocusSessionCurrentResponse,
  type FocusSessionListItem,
  type FocusSessionListQuery,
  type FocusSessionListResponse,
  type FocusSessionResponse,
  type SessionAlreadyActiveResponse,
  type StartFocusSessionRequest,
} from '@focus-tracker/shared';
import { PrismaService } from '../prisma/prisma.service';
import { wallClockInTz } from '../activity/tz.util';

// Focus-session lifecycle service (FocusSession.md §3, §9).
//
// Single source of truth for state transitions. Every public method either
// returns a canonical FocusSessionResponse (post-change) or throws a typed
// exception that the controller maps to the right HTTP status.
//
// Concurrency:
//   * The partial unique index on (userId) WHERE state IN ('running','paused')
//     (prisma/migrations/20260614202307_focus_session_partial_unique) is the
//     ultimate guard against double-starts. `start()` races against that
//     index — we catch Prisma's P2002 and re-fetch the winning session for
//     the 409 body so we don't lose the race between "no active found" and
//     "insert".
//   * Pause/resume/stop are gated by `state` equality in the WHERE clause
//     so parallel requests at most leak a 404 to the loser, never corrupt
//     the row.
//
// ponytail: `aborted` state is only set by the crash-abort scheduler. The
// controller doesn't expose a user-facing "abort" action (the spec's abort
// is server-side only, §9.8).

@Injectable()
export class FocusSessionsService {
  private readonly logger = new Logger(FocusSessionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  //  Reads
  // ---------------------------------------------------------------------------

  async getCurrent(userId: string): Promise<FocusSessionCurrentResponse> {
    const session = await this.prisma.focusSession.findFirst({
      where: { userId, state: { in: ['running', 'paused'] } },
      orderBy: { startedAt: 'desc' },
      include: { pauses: { orderBy: { pausedAt: 'asc' } } },
    });
    return { session: session ? this.toResponse(session) : null };
  }

  async getById(userId: string, id: string): Promise<FocusSessionResponse> {
    const row = await this.prisma.focusSession.findFirst({
      where: { id, userId }, // scope by user to prevent cross-user leaks
      include: { pauses: { orderBy: { pausedAt: 'asc' } } },
    });
    if (!row) throw new NotFoundException({ error: 'session_not_found' });
    return this.toResponse(row);
  }

  async list(
    userId: string,
    query: FocusSessionListQuery,
  ): Promise<FocusSessionListResponse> {
    const { fromDate, toDate } = await this.resolveRange(userId, query);
    const rows = await this.prisma.focusSession.findMany({
      where: {
        userId,
        startedAt: {
          ...(fromDate ? { gte: fromDate } : {}),
          ...(toDate ? { lte: toDate } : {}),
        },
      },
      orderBy: { startedAt: 'desc' },
      take: query.limit ?? 100,
      include: { pauses: { select: { pausedAt: true, resumedAt: true } } },
    });
    return {
      sessions: rows.map((r) => this.toListItem(r, r.pauses)),
    };
  }

  // ---------------------------------------------------------------------------
  //  Lifecycle mutations
  // ---------------------------------------------------------------------------

  /// §9.1 start. Returns the new session on success; throws a ConflictException
  /// carrying the §9.1 payload when one is already active.
  async start(
    userId: string,
    body: StartFocusSessionRequest,
  ): Promise<FocusSessionResponse> {
    const taskId = body.taskId ?? null;
    if (taskId) {
      // Ownership gate: optional task must belong to this user.
      const task = await this.prisma.task.findFirst({
        where: { id: taskId, userId },
        select: { id: true },
      });
      if (!task) throw new NotFoundException({ error: 'task_not_found' });
    }

    try {
      const created = await this.prisma.focusSession.create({
        data: {
          userId,
          taskId,
          mode: body.mode,
          plannedDurationMs:
            body.mode === 'timer' ? body.plannedDurationMs! : null,
          state: 'running',
          startedAt: new Date(),
        },
        include: { pauses: true },
      });
      return this.toResponse(created);
    } catch (err) {
      // P2002 = unique-constraint violation. The partial index catches the
      // race where getCurrent() saw null but someone else inserted first.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const existing = await this.prisma.focusSession.findFirst({
          where: { userId, state: { in: ['running', 'paused'] } },
          orderBy: { startedAt: 'desc' },
        });
        if (existing) {
          const payload: SessionAlreadyActiveResponse = {
            error: 'session_already_active',
            existingSessionId: existing.id,
            existingSession: {
              state: existing.state,
              mode: existing.mode,
              startedAt: existing.startedAt.toISOString(),
              plannedDurationMs: existing.plannedDurationMs,
              taskId: existing.taskId,
            },
          };
          throw new ConflictException(payload);
        }
      }
      throw err;
    }
  }

  /// §9.2 pause. No-op if already paused (idempotent for flaky clients);
  /// 422 if completed/aborted.
  async pause(userId: string, id: string): Promise<FocusSessionResponse> {
    const session = await this.loadMutableOrThrow(userId, id);
    if (session.state === 'paused') return this.getById(userId, id);
    if (session.state !== 'running') {
      throw new UnprocessableEntityException({
        error: 'invalid_state_transition',
        hint: `cannot pause from state '${session.state}'`,
      });
    }
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.focusSession.update({
        where: { id },
        data: { state: 'paused' },
      }),
      this.prisma.focusSessionPause.create({
        data: { sessionId: id, pausedAt: now },
      }),
    ]);
    return this.getById(userId, id);
  }

  /// §9.3 resume. Closes the open pause row and flips state back to running.
  async resume(userId: string, id: string): Promise<FocusSessionResponse> {
    const session = await this.loadMutableOrThrow(userId, id);
    if (session.state === 'running') return this.getById(userId, id);
    if (session.state !== 'paused') {
      throw new UnprocessableEntityException({
        error: 'invalid_state_transition',
        hint: `cannot resume from state '${session.state}'`,
      });
    }

    const openPause = await this.prisma.focusSessionPause.findFirst({
      where: { sessionId: id, resumedAt: null },
      orderBy: { pausedAt: 'desc' },
    });
    const now = new Date();
    const updates: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.focusSession.update({
        where: { id },
        data: { state: 'running' },
      }),
    ];
    if (openPause) {
      // Defensive: if durationMs underflows (clock skew), floor at 0 so we
      // don't persist a negative.
      const duration = Math.max(0, now.getTime() - openPause.pausedAt.getTime());
      updates.push(
        this.prisma.focusSessionPause.update({
          where: { id: openPause.id },
          data: { resumedAt: now, durationMs: duration },
        }),
      );
    } else {
      // paused with no open pause row = data inconsistency; log and bail
      // soft (session state flips back, no pause record touched).
      this.logger.warn(`resume: session ${id} was paused with no open pause row`);
    }
    await this.prisma.$transaction(updates);
    return this.getById(userId, id);
  }

  /// §9.4 stop (manual). If paused, closes the open pause row first so the
  /// effective-duration math is clean (§3.2 "resumedAt = endedAt").
  async stop(userId: string, id: string): Promise<FocusSessionResponse> {
    return this.endSession(userId, id, 'manual_stop');
  }

  // ---------------------------------------------------------------------------
  //  Internal: used by stop() and by the schedulers (timer expiry + 24h abort)
  // ---------------------------------------------------------------------------

  /// Transitions a session to `completed` (or `aborted` when called from the
  /// abort scheduler) and computes `effectiveDurationMs`. Idempotent — a
  /// second call on an already-ended session returns the current snapshot
  /// without mutating.
  async endSession(
    userId: string,
    id: string,
    endReason: 'manual_stop' | 'timer_complete' | 'aborted',
    endedAtOverride?: Date,
  ): Promise<FocusSessionResponse> {
    const session = await this.loadMutableOrThrow(userId, id);
    if (session.state === 'completed' || session.state === 'aborted') {
      return this.getById(userId, id);
    }

    const endedAt = endedAtOverride ?? new Date();

    // Close any open pause so the pauses relation is clean before we compute
    // the effective duration.
    if (session.state === 'paused') {
      const openPause = await this.prisma.focusSessionPause.findFirst({
        where: { sessionId: id, resumedAt: null },
        orderBy: { pausedAt: 'desc' },
      });
      if (openPause) {
        const duration = Math.max(0, endedAt.getTime() - openPause.pausedAt.getTime());
        await this.prisma.focusSessionPause.update({
          where: { id: openPause.id },
          data: { resumedAt: endedAt, durationMs: duration },
        });
      }
    }

    // Load fresh pauses after the close-open-pause step.
    const pauses = await this.prisma.focusSessionPause.findMany({
      where: { sessionId: id },
      orderBy: { pausedAt: 'asc' },
    });
    const wallMs = Math.max(0, endedAt.getTime() - session.startedAt.getTime());
    const pauseMs = pauses.reduce(
      (acc, p) => acc + (p.durationMs ?? 0),
      0,
    );
    const effective = Math.max(0, wallMs - pauseMs);

    const state = endReason === 'aborted' ? 'aborted' : 'completed';
    await this.prisma.focusSession.update({
      where: { id },
      data: {
        state,
        endedAt,
        endReason,
        effectiveDurationMs: effective,
      },
    });
    return this.getById(userId, id);
  }

  // ---------------------------------------------------------------------------
  //  Scheduler helpers — called by maintenance.scheduler.ts in a follow-up
  // ---------------------------------------------------------------------------

  /// Finds timer-mode sessions whose RUNNING time has reached plannedDurationMs
  /// and completes each. Running time = (now - startedAt) - Σ pauses.
  /// Uses the same math as the client so the "it ended!" transition isn't
  /// surprising.
  ///
  /// Called from a @Cron job in maintenance.scheduler.ts (planned next todo).
  async expireDueTimers(): Promise<{ expired: number }> {
    const now = new Date();
    const candidates = await this.prisma.focusSession.findMany({
      where: {
        mode: 'timer',
        state: { in: ['running', 'paused'] },
        plannedDurationMs: { not: null },
      },
      include: { pauses: true },
    });
    let expired = 0;
    for (const s of candidates) {
      // Convert the DB rows into the shared helper's expected shape.
      const effective = Math.max(
        0,
        now.getTime() - s.startedAt.getTime() -
          s.pauses.reduce((acc, p) => {
            if (p.resumedAt) return acc + (p.durationMs ?? 0);
            return acc + Math.max(0, now.getTime() - p.pausedAt.getTime());
          }, 0),
      );
      if (effective >= (s.plannedDurationMs ?? Infinity)) {
        // endedAt lands exactly when planned duration elapsed (not `now`) so
        // the summary shows a clean "25:00" not "25:03".
        const endedAt = new Date(
          s.startedAt.getTime() +
            (s.plannedDurationMs ?? 0) +
            // Add back the total paused time so the wall-clock endedAt covers
            // the full planned effective duration.
            s.pauses.reduce((acc, p) => {
              if (p.resumedAt) return acc + (p.durationMs ?? 0);
              return acc + Math.max(0, now.getTime() - p.pausedAt.getTime());
            }, 0),
        );
        await this.endSession(s.userId, s.id, 'timer_complete', endedAt);
        expired++;
      }
    }
    return { expired };
  }

  /// §9.8 — mark sessions that have been running/paused for > 24h as aborted.
  /// endedAt lands at startedAt + 24h (or plannedDurationMs, whichever is
  /// smaller) so Memento Mori's weekly shading can't be contaminated by a
  /// phantom multi-day session.
  async abortStaleSessions(): Promise<{ aborted: number }> {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const stale = await this.prisma.focusSession.findMany({
      where: {
        state: { in: ['running', 'paused'] },
        startedAt: { lt: dayAgo },
      },
      select: { id: true, userId: true, startedAt: true, plannedDurationMs: true },
    });
    for (const s of stale) {
      const capMs = Math.min(
        24 * 60 * 60 * 1000,
        s.plannedDurationMs ?? Number.POSITIVE_INFINITY,
      );
      const endedAt = new Date(s.startedAt.getTime() + capMs);
      await this.endSession(s.userId, s.id, 'aborted', endedAt);
    }
    return { aborted: stale.length };
  }

  // ---------------------------------------------------------------------------
  //  Shape helpers
  // ---------------------------------------------------------------------------

  private async loadMutableOrThrow(
    userId: string,
    id: string,
  ): Promise<FocusSession> {
    const row = await this.prisma.focusSession.findFirst({
      where: { id, userId },
    });
    if (!row) throw new NotFoundException({ error: 'session_not_found' });
    return row;
  }

  private toResponse(
    row: FocusSession & { pauses: FocusSessionPause[] },
  ): FocusSessionResponse {
    return {
      id: row.id,
      mode: row.mode,
      state: row.state,
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt ? row.endedAt.toISOString() : null,
      plannedDurationMs: row.plannedDurationMs,
      effectiveDurationMs: row.effectiveDurationMs,
      endReason: row.endReason,
      taskId: row.taskId,
      pauses: row.pauses.map((p) => ({
        id: p.id,
        pausedAt: p.pausedAt.toISOString(),
        resumedAt: p.resumedAt ? p.resumedAt.toISOString() : null,
        durationMs: p.durationMs,
      })),
    };
  }

  private toListItem(
    row: FocusSession,
    pauses: readonly { pausedAt: Date; resumedAt: Date | null }[],
  ): FocusSessionListItem {
    const pauseTotalMs = sumPauseMs(
      pauses.map((p) => ({
        pausedAt: p.pausedAt.toISOString(),
        resumedAt: p.resumedAt ? p.resumedAt.toISOString() : null,
      })),
      row.endedAt ?? new Date(),
    );
    // Prefer the server's stored effective duration for finished sessions.
    // For running/paused, derive live.
    const liveEffective =
      row.state === 'completed' || row.state === 'aborted'
        ? row.effectiveDurationMs
        : effectiveMs({
            startedAt: row.startedAt.toISOString(),
            endedAt: row.endedAt ? row.endedAt.toISOString() : null,
            pauses: pauses.map((p) => ({
              pausedAt: p.pausedAt.toISOString(),
              resumedAt: p.resumedAt ? p.resumedAt.toISOString() : null,
            })),
          } as FocusSessionResponse);
    return {
      id: row.id,
      mode: row.mode,
      state: row.state,
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt ? row.endedAt.toISOString() : null,
      plannedDurationMs: row.plannedDurationMs,
      effectiveDurationMs: liveEffective,
      endReason: row.endReason,
      taskId: row.taskId,
      pauseCount: pauses.length,
      pauseTotalMs,
    };
  }

  /// Resolves a list query's `from`/`to` to Date instances. Accepts either
  /// ISO timestamps (used as-is) or YYYY-MM-DD (interpreted as the start /
  /// end of that day in the user's tz).
  private async resolveRange(
    userId: string,
    query: FocusSessionListQuery,
  ): Promise<{ fromDate?: Date; toDate?: Date }> {
    const tz = await this.resolveTz(userId);
    const toDate = query.to ? parseWhen(query.to, tz, 'end') : undefined;
    const fromDate = query.from ? parseWhen(query.from, tz, 'start') : undefined;
    return { fromDate, toDate };
  }

  private async resolveTz(userId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    return u?.timezone ?? 'UTC';
  }
}

// ---------------------------------------------------------------------------
//  Local helpers
// ---------------------------------------------------------------------------

/// Parse either a YYYY-MM-DD (day-bucketed in the user's tz) or a full ISO
/// timestamp (already absolute). Returns a `Date` representing either the
/// start or end of day for date-only inputs.
function parseWhen(input: string, tz: string, edge: 'start' | 'end'): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [y, m, d] = input.split('-').map(Number);
    if (!y || !m || !d) throw new Error(`bad date: ${input}`);
    const hour = edge === 'start' ? 0 : 23;
    const minute = edge === 'start' ? 0 : 59;
    const second = edge === 'start' ? 0 : 59;
    const ms = edge === 'start' ? 0 : 999;
    // Compute the UTC instant that corresponds to `h:m:s` wall-clock in tz.
    const naiveUtcMs = Date.UTC(y, m - 1, d, hour, minute, second, ms);
    const wc = wallClockInTz(new Date(naiveUtcMs), tz);
    const observedUtcMs = Date.UTC(
      wc.year,
      wc.month - 1,
      wc.day,
      wc.hour,
      wc.minute,
      wc.second,
      ms,
    );
    const offsetMs = observedUtcMs - naiveUtcMs;
    return new Date(naiveUtcMs - offsetMs);
  }
  return new Date(input);
}
