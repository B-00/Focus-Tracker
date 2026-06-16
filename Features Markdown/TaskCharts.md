# Focus Tracker — Task Charts (Feature Spec)

> Consistency visualization for tasks. Two parallel families (Routine and Dated) shown at two granularities (global aggregate across all sections, and per-Section for the Dated family only).
> Each chart block renders a single visual: a **stock-market-style cumulative-score time-series chart**. Both families use the same base score formula (a **priority-weighted**, mid-as-reference completion ratio with a -1 floor for zero-completion days — see `Tasks.md` §3.6) plus a Dated-only Backlog penalty (§5).

**Status:** Specification in progress. v1 first batch (see `PROJECT.md` §6).

---

## 1. Overview

There are two kinds of tasks whose completion has a meaningful per-day shape:

1. **Routine tasks** generate `TaskInstance` rows for every scheduled occurrence (see `Tasks.md` §3.3) — so "did I do today's instance?" is a natural daily question.
2. **Single-day dated tasks** have an explicit due day. With the transfer/backlog rule (`Tasks.md` §5.6), the question "did I complete this task on its due day?" is honest history.

Multi-day dated tasks and ongoing tasks are explicitly **excluded** from these charts — they have no per-day completion semantics.

### Three chart blocks total

| Chart block               | Scope                                                      | Rendered on                          |
| ------------------------- | ---------------------------------------------------------- | ------------------------------------ |
| **Global Routine chart**  | All routine `TaskInstance`s across all Sections + Inbox     | `/tasks` (top of page) and Dashboard |
| **Global Dated chart**    | All single-day dated tasks across all Sections + Inbox      | `/tasks` (top of page) and Dashboard |
| **Per-Section Dated chart** | Single-day dated tasks for ONE Section                    | `/tasks` Dated panel, at the top of that Section's block |

Routine charts are intentionally **global only** in v1 — per-Section routine breakdowns are not rendered. Routines feel naturally global (a "consistency life-area view"), and avoiding per-Section routine charts keeps the Routine panel of `/tasks` quiet — just the routine task lists.

Dated charts come in **both granularities** — global (the overall "did I deliver on my dated commitments?" picture) and per-Section (so you can see which life-areas are doing well vs which are leaking into the Backlog).

Each chart block renders **one visual**: a stock-market-styled cumulative-score chart. Days score between **-1 and +2** via the base score rule (the upper bound depends on the day's priority mix — see §5.1); Dated days can dip further negative when tasks enter the Backlog (see §5.3). The line plots the running total over time, behaving like a stock price.

The two families share the same base score formula (mid-as-reference completion ratio with a -1 floor) but **differ on the Backlog modifier** — Dated only. The mid-as-reference scale means completing an `extreme` task is worth more than completing a `mid`, and completing a `low` is worth less — so a day of extreme-priority work can soar above the +1 mid baseline, while a day of low-priority work caps below it. See §5.1 for the exact weights and rationale.

A future v2 may layer a GitHub-style completion heatmap above each line chart for at-a-glance daily intensity — see §11 Future Work. v1 stays line-only.

---

## 2. Goals & Non-Goals

### Goals
- Make "am I keeping up?" answerable at a glance both globally and per life-area.
- Reward consistency visually (rising chart line).
- Make missed days and Backlog events visible as concrete downward moves in the line.
- Stay un-intrusive: per-Section Dated charts live inline above their tasks; global charts pin to the top of `/tasks` and to the dashboard.

### Non-Goals (v1)
- Dedicated `/charts` or `/analytics` route.
- Charts for multi-day dated tasks or ongoing tasks (no per-day completion concept).
- A unified "all tasks combined" chart that fuses Routine and Dated families (they have different scoring populations and shouldn't be mashed together).
- **Per-Section Routine charts** (deferred — global routine view only for v1).
- **Completion heatmap visual** (GitHub-contributions-style 7×N grid) — deferred to v2 (see §11 Future Work).
- Goal-setting (target completion rate, target streak, etc.).
- Predictive / forecasting overlays.
- Sharing / exporting charts as images.

---

## 3. Where Charts Live

### 3.1 On `/tasks`

```
┌─────────────────────────────────────────────────────────────┐
│ GLOBAL CHARTS                                               │  ← §3.3
│   [ global routine cumulative-score chart ]                 │
│   [ global dated cumulative-score chart ]                   │
├─────────────────────────────────────────────────────────────┤
│ ROUTINE                                                     │  ← just lists, no per-Section charts
│   Section: Workout                                          │
│     ☑ Stretching (daily)                                    │
│     ☐ Run (Mon/Wed/Fri)                                     │
│   Section: Work                                             │
│     ☑ Daily standup notes (Mon-Fri)                         │
├─────────────────────────────────────────────────────────────┤
│ DATED                                                       │
│   Section: Work                                             │
│     [ per-Section dated cumulative-score chart ]            │  ← §3.2
│     ☐ Q3 report (Jun 1 – Jun 15)   (multi-day; not counted) │
│     ☐ Review PR (Jun 12) ↻                                  │
│   Section: Personal                                         │
│     [ per-Section dated cumulative-score chart ]            │
│     ☐ Renew passport (Jun 30) ↻                             │
├─────────────────────────────────────────────────────────────┤
│ ONGOING / BACKLOG  (no charts — just lists)                 │
└─────────────────────────────────────────────────────────────┘
```

The global-charts panel at the top is collapsible (state persisted in local UI prefs); same for each individual chart block.

### 3.2 Per-Section Dated charts (rendering rule)

A per-Section Dated chart renders for a Section only if it has **at least one single-day dated task in its history** (including completed, missed, transferred, or backlogged tasks). Sections with only multi-day dated tasks get no chart — the tasks still appear in the list below.

### 3.3 Global charts (Routine and Dated)

Two global charts render at the top of `/tasks`, one per family:

- **Global Routine chart** — aggregates routine `TaskInstance`s across **all Sections and the Inbox**. Renders if the user has at least one non-archived routine task.
- **Global Dated chart** — aggregates single-day dated task lifecycle data across **all Sections and the Inbox**. Renders if at least one single-day dated task has ever been due.

### 3.4 On the dashboard

The same two global charts also render as compact widgets on the dashboard (see `Tasks.md` §4.2). The dashboard versions are visually compressed (default range 30 days instead of 90; no `1Y / All` range pills) so they fit alongside the other dashboard widgets; the data behind them is identical to the `/tasks` versions.

### 3.5 No per-Section Routine charts

Per-Section routine breakdowns are intentionally **not rendered in v1** (see §2 Non-Goals). The Routine panel on `/tasks` lists routine tasks per Section without any chart above them. The user's consistency story for routines is told globally on the dashboard + at the top of `/tasks`.

(The underlying `routine_section_daily_score` table is still populated — see §5.4 — both because the global chart's aggregation reads from it and because a future per-Section routine breakdown can be enabled without a data migration.)

---

## 4. Time-series chart ("stock-market style")

### 4.1 Intent

An area-or-line chart styled to evoke a stock chart: horizontal time axis, vertical numeric axis, a primary line tracking the **cumulative consistency score** over time (formula in §5), and stock-chart conventions for navigation (range pills, hover crosshair, gridlines, today marker).

### 4.2 Layout

- **X axis**: time (days), left-to-right oldest-to-newest. Default range: rolling **90 days**. Range selector pills above the chart: `1M / 3M / 6M / 1Y / All`. (Dashboard widget versions omit `1Y / All` for space — see §3.4.)
- **Y axis**: cumulative score (signed; can be negative). Auto-scales to the data in the visible range, like a stock chart's default Y zoom — the axis is **not** range-reset to zero. The cumulative line is continuous across all range selections; the pills just zoom the x-axis window.
  - **Routine charts:** daily scores are bounded to `[-1, +2]` — the upper bound is reached only on days where the schedule is 100% `extreme` and you complete it all; mid-only days cap at +1 and low-only days cap at +0.5 (see §5.1). Cumulative range grows at most by `+2` or `-1` per day.
  - **Dated charts:** daily scores can dip below -1 when tasks enter the Backlog (geometric-decay penalty — see §5.3). The penalty is **bounded near -3** regardless of how many tasks enter Backlog on the same day, so daily score is bounded between approximately **`[-4, +2]`**. Multi-backlog days produce visible cliffs in the line (the desired "stocks-can-crash" feel) without a catastrophic single-day collapse; extreme-completion days produce mirror-image upward cliffs.
- **Primary line**: the running total of daily scores from this family / scope's first scheduled day onward.
- **Zero baseline**: a subtle horizontal reference line at y = 0 (the "you'd be break-even here" line).
- **Today marker**: subtle vertical guide at the right edge. Today's data point itself is rendered as a small distinct dot labeled "in progress" (see §4.5).
- **Hover crosshair**: vertical line + tooltip showing date, that day's `score`, and the cumulative value. The tooltip also shows the breakdown so the priority story is legible: `Completed 3 of 5 — weighted 4.5 of count 5 → baseScore +0.900 (max possible today was +1.400)`. For Dated days with a Backlog penalty, the tooltip extends with the modifier: `... + backlogPenalty -2.0 (1 task: ▲▲ extreme) = -1.100`. The "max possible today" hint surfaces `scheduledWeight / scheduledCount` so the user can see what a clean day on this particular schedule would have scored — useful for distinguishing an extreme-heavy day's +0.9 from a low-heavy day's +0.9.
- **Deferred secondary elements (not v1):**
  - Volume-style bars at the bottom (e.g. number of items scheduled per day).
  - Candlestick aggregation for weekly / monthly views.
  - Heatmap overlay above the line (see §11 Future Work).

### 4.3 Library

- **Recharts** (already in the stack — see `PROJECT.md` §2.1) covers v1's area/line chart needs. A signed cumulative y-axis is a standard Recharts pattern. No new dependency needed for v1.
- If candlesticks / volume bars are added later, re-evaluate `lightweight-charts` (TradingView's open-source library) — out of scope for v1.

### 4.4 Empty state

- If a Section has no eligible items yet for this family (no routine instances, or no single-day dated tasks have ever come due), render the axes with a "Not enough data yet — keep at it" overlay.

### 4.5 Today's data point

Today's daily score is **not finalized until the nightly maintenance job runs** (see `Tasks.md` §5.5). To avoid showing a misleading provisional point on the historical line:

- The cumulative line ends at **yesterday**.
- A separate "today" marker is rendered at the right edge with a tooltip like:
  - Routine: "Today: 2 of 3 routines completed so far — final score posts overnight."
  - Dated: "Today: 1 of 2 dated tasks completed so far — final score posts overnight."
- Once the nightly job runs, today's marker becomes yesterday's line endpoint, and a new today marker takes its place.

---

## 5. The scoring formula

The scoring rule is **identical** across both families — what differs is the population of "scheduled" and "completed" items. The formula uses a **mid-priority reference scale**: each completed task contributes its priority weight to the numerator, but the denominator is the *count* of scheduled tasks (treating `mid` as the reference baseline of `1.0`). This means completing extreme work genuinely scores above the +1 baseline, while completing only low work honestly scores below it.

### 5.1 Base score (range: `[-1, +2]`)

#### Priority weights

Each completed task contributes a weight equal to its `priority` (see `Tasks.md` §3.6):

| Priority  | Weight `w` |
| --------- | ---------- |
| `extreme` | **2.0**    |
| `high`    | **1.5**    |
| `mid`     | **1.0**    |
| `low`     | **0.5**    |

Weights are **fixed constants** in v1, not a user setting (see `Tasks.md` §9 Open Questions). The choice of `mid = 1.0` makes mid the reference unit: a day that schedules only mid tasks and completes them all scores exactly +1.0, identical to a simple un-weighted ratio.

#### Formula

For each Section, each day, for one family — the **base score** is the sum of completed priority weights normalised by the count of scheduled tasks (NOT by the weighted total), with two boundary rules:

| Situation                                              | Base score                                                  |
| ------------------------------------------------------ | ----------------------------------------------------------- |
| No items scheduled that day (`scheduledCount == 0`)    | **0**                                                       |
| At least one scheduled, **zero** completed             | **-1**                                                      |
| At least one scheduled, **at least one** completed     | **`completedWeight / scheduledCount`** (range: 0 exclusive to +2.0 inclusive) |

Formally:

```
priorityWeight(p) = { extreme: 2.0, high: 1.5, mid: 1.0, low: 0.5 }[p]

scheduledCount   = |scheduled set|                                          # raw count, drives the denominator
completedCount   = |completed set|                                          # raw count, kept for display
scheduledWeight  = Σ priorityWeight(task.priority)  for task in scheduled set   # kept for tooltip ("would-be-max if all done")
completedWeight  = Σ priorityWeight(task.priority)  for task in completed set   # drives the numerator

if scheduledCount == 0:         baseScore = 0.0
elif completedWeight == 0:      baseScore = -1.0
else:                           baseScore = completedWeight / scheduledCount    # (0, +2.0]
```

#### Why divide by count, not by weight?

This is the heart of the model. There are two reasonable normalisers:

| Denominator         | Behavior                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `scheduledWeight`   | "Graded on a curve" — every day capped at +1.0 regardless of priority mix. Completing 5 extremes ≡ completing 5 mids ≡ +1.0. Priority only shapes partial days. |
| **`scheduledCount`** *(chosen)* | "Graded on an absolute scale" — mid is the baseline; extreme days exceed +1.0; low days never reach it. Completing 5 extremes = +2.0; completing 5 mids = +1.0; completing 5 lows = +0.5. |

The count-based denominator was chosen so that completing high-priority work visibly scores higher than completing low-priority work — that's the whole point of having a priority system. The trade-off: the daily score ceiling now depends on which priorities you schedule. A day of 100% extreme completion peaks at +2.0; a day of 100% mid completion peaks at +1.0; a day of 100% low completion peaks at +0.5.

#### Effects on partial-completion days

Some example days, all with 5 scheduled tasks, comparing to a hypothetical un-weighted baseline:

| Day's situation (5 tasks total)                                   | Un-weighted equivalent | Mid-reference base score (new)         |
| ----------------------------------------------------------------- | ---------------------- | -------------------------------------- |
| 5 mid completed of 5 mid scheduled                                | +1.000                 | 5.0 / 5 = **+1.000** (unchanged baseline) |
| 5 extreme completed of 5 extreme scheduled                        | +1.000                 | 10.0 / 5 = **+2.000** (extreme day peaks high) |
| 5 low completed of 5 low scheduled                                | +1.000                 | 2.5 / 5 = **+0.500** (honest: low effort)  |
| Mixed: 1 extreme + 4 mid, all done                                | +1.000                 | 6.0 / 5 = **+1.200**                    |
| 1 of 5 done — the 1 was `extreme`, rest mid                       | +0.200                 | 2.0 / 5 = **+0.400** (extreme done shines) |
| 1 of 5 done — the 1 was `low`, missed 4 were extreme              | +0.200                 | 0.5 / 5 = **+0.100** (low effort, missed extremes) |
| 4 of 5 done, missed one was `extreme`, rest mid                   | +0.800                 | 4.0 / 5 = **+0.800**                    |
| 4 of 5 done, missed one was `low`, rest mid                       | +0.800                 | 4.5 / 5 = **+0.900**                    |

**Three boundary cases worth noting:**
- The **-1 floor** for zero-completion days is the harshest signal; it means "you had something scheduled and did none of it." Priority is irrelevant in this case — zero completion is zero completion. (Asymmetric punishment for "missing extreme work" on Dated tasks comes through the Backlog penalty's priority-ordering — see §5.3.)
- A **mid-only day** behaves identically to the un-weighted model. This means users who don't bother thinking about priority and pick `mid` on everything will see exactly the chart they'd see without priority weighting — no surprises.
- A **fully-completed low-only day** scores **+0.500**, not +1.0. This is deliberate: a day of low-effort busywork is honestly logged as a lower-impact day even if "everything got done." If this feels demotivating in practice, the natural response is to either re-classify those tasks as `mid` (if they actually matter) or accept that low-priority days don't move the chart much (the whole point of the priority signal).

### 5.2 What counts as "scheduled" and "completed" — per family

#### Routine family
- **`scheduled set`** = `TaskInstance` rows for this section on this date (one per scheduled routine occurrence). Each instance contributes `1` to `scheduledCount` and `priorityWeight(instance.priority)` to `scheduledWeight`.
- **`completed set`** = those rows with `completedAt IS NOT NULL`. Each completed instance contributes `priorityWeight(instance.priority)` to `completedWeight` (this drives the numerator of the base score).
- **`backlogCount`** = 0 (routines have no backlog concept).
- **Priority source:** the instance's own `priority` snapshot (see `Tasks.md` §3.3) — *not* the parent routine's current `priority`. This keeps historical scores stable when the user edits a routine's priority going forward.
- This rule depends on missed days being present as rows in `TaskInstance` (otherwise "zero completed" is indistinguishable from "you didn't open the app"). The nightly maintenance job in `Tasks.md` §5.5 guarantees this.

#### Dated family
- **`scheduled set`** = single-day dated tasks (`kind = 'dated'` AND `endDate IS NULL OR endDate = startDate`) for this section whose **due day was this date**. "Due day" is captured as a snapshot at end-of-day by the nightly job (see §5.4) — it doesn't shift when the task subsequently transfers forward. Each task contributes `1` to `scheduledCount` and `priorityWeight(task.priority)` to `scheduledWeight` at the moment the snapshot is taken (priority value at end-of-day).
- **`completed set`** = of those tasks, the ones with `completedAt IS NOT NULL AND completedAt <= end_of_that_day_local`. Each contributes `priorityWeight(task.priority)` to `completedWeight`.
- **`backlogCount`** = of those tasks, the ones **entering Backlog at end of this day** — i.e. `completedAt IS NULL AND transferredFromDate IS NOT NULL AND inBacklog will be true after tonight's job runs`. In practice: a task whose previous-day's miss already used up its single transfer, missed again today.
- **Multi-day dated tasks contribute zero** to all counts and weights. Ongoing tasks contribute zero.
- **Per-day score with the backlog modifier:** dated days apply the base score AND a geometric-decay backlog penalty layered on top (-2 for the highest-priority task entering backlog today, half-of-that for each subsequent task in descending priority order, bounded near -3). See §5.3 for the full formula and §5.5 for worked examples.

#### Why store `scheduledWeight` even though it's not in the denominator?

The formula in §5.1 uses `scheduledCount` (not weight) as the denominator. `scheduledWeight` is still stored on every score row because:
- The tooltip shows "would-be-max score if all done" (= `scheduledWeight / scheduledCount`), so users can see what a clean day on this schedule would have scored.
- It enables the existing un-weighted ratio (`completedWeight / scheduledWeight`) to also be reported in the tooltip as a secondary "completion %" alongside the count-based base score — useful for users who want to see "did I finish what I scheduled" separate from "how impactful was today."
- If the open question about switching to a multiplicative backlog penalty (§10) is ever revisited, having `scheduledWeight` already stored avoids a backfill.

#### Why a snapshot table for dated, but a row table for routine?
Routine's `TaskInstance` already captures the "scheduled" event as a row — we read it directly. Dated tasks don't have an equivalent: a task with `startDate = Monday` *was* due Monday, but by the time we look at it days later, its `startDate` may have moved (transfer) or it may have entered the Backlog. So the nightly job freezes the "due day" assignment AND the priority weight snapshot at end-of-day before the transfer logic runs — see §5.4.

### 5.3 Dated-only modifier — the backlog penalty (geometric decay, priority-ordered)

On top of the base score, each dated day's score also includes an additive **backlog penalty** for any single-day dated tasks that enter the Backlog at end of that day. The penalty uses a **geometric-decay** rule so the first (highest-priority) task entering backlog is a sharp shock, each subsequent task contributes half as much as the previous, and the total per-day penalty is **bounded near -3** no matter how many tasks fall through.

**Priority ordering of backlog tasks.** Before applying the decay, the backlog tasks for the day are **sorted by descending priority** (extreme → high → mid → low). Ties within the same priority are broken by oldest `transferredFromDate` first (most-stale tasks lead). The highest-priority task therefore always absorbs the worst term (-2); lower-priority tasks get the diminishing terms. This means "letting an extreme task fall to backlog" is always strictly worse than "letting a low task fall to backlog," even though the day's total bound is still near -3.

**Per-task contribution rule** (after the priority-sorted ordering):
- 1st task (highest priority): **-2** (= -1 for missing the transferred task + -1 for the Backlog event itself, as the user describes it mentally)
- 2nd task: -0.5 (which is `1/2`)
- 3rd task: -0.25 (which is the previous halved)
- 4th task: -0.125
- 5th task: -0.0625
- *k*-th task (for *k* ≥ 2): `-(1/2)^(k-1)`

**Closed form:**

```
backlogPenalty(N) = 0                       if N == 0
                  = -3 + (1/2)^(N-1)        if N >= 1   (N = backlogCount)

datedDayScore     = baseScore(scheduledCount, completedWeight) + backlogPenalty(N)
```

The penalty value depends only on `N` (the *count* of tasks entering backlog), not on the sum of their weights. Priority affects **which** task takes the -2 hit (via the descending-priority ordering), not the **magnitude** of the per-term penalty.

**Penalty values across N:**

| `backlogCount` | Penalty           |
| -------------- | ----------------- |
| 0              | 0                 |
| 1              | -2.000            |
| 2              | -2.500            |
| 3              | -2.750            |
| 4              | -2.875            |
| 5              | -2.9375           |
| 6              | -2.96875          |
| 10             | ≈ -2.998          |
| ∞              | approaches -3 (never reaches) |

**Why geometric decay, not linear `-2 * N`:** linear scaling makes catastrophic days uncapped (5 tasks to backlog = -10). The user explicitly chose this rule to model "the first backlog event is a real shock, but if you're already having a terrible day, each additional one shouldn't pile on as hard." Combined with the base floor of -1, the worst possible daily score is bounded just above **-4**.

**Why priority order the penalty terms instead of weighting them by priority?** A weighted variant (e.g. `-2 * priorityWeight(task)`) would push the worst-case score below -5 (a single extreme to backlog: `-2 * 2.0 = -4` penalty alone, plus base score `= -5+`). Priority-ordering preserves the `[-4, +2]` bound on the daily score (base in `[-1, +2]` plus penalty in `(-3, 0]`) while still making "extreme to backlog" strictly worse than "low to backlog" (the extreme takes the -2 term; the low takes a small decay term). See §10 for the open question of whether to ever switch to multiplicative weighting.

**The user's mental decomposition** ("`-1` for not completing the transferred task + `-1` for the Backlog event") still holds for the 1st task → -2. Subsequent tasks share a single shrinking "additional damage" allowance because they're already in a bad situation.

**Why this is on top of the base score, not replacing it.** The missed-and-going-to-backlog task is already counted in `scheduledCount` and *not* in `completedWeight`, so it already lowers the base score (a 1-of-2 mid/mid day scores +0.5 instead of +1; a 1-of-2 day where the missed one was extreme and the completed one was mid scores `1.0 / 2 = +0.5`, same as the all-mid case — base scoring doesn't differentially punish missing extreme on its own, that's the Backlog penalty's job). A day where you completed 4 of 5 tasks and let 1 fall to backlog still produces a sharply negative score (`baseScore ~+0.8 + -2 = -1.2`), which is the intent.

**The backlog penalty does not apply to routines** (`routineDaysOfWeek` misses contribute only via the base score — routines have their own miss-handling story via the chart, no Backlog to penalise).

### 5.4 Storage

Scores live in **two precomputed tables**, one per family, so the chart can be served as a fast range scan:

`routine_section_daily_score`

| Column            | Type                  | Notes                                                          |
| ----------------- | --------------------- | -------------------------------------------------------------- |
| `sectionId`       | uuid                  | Composite PK with `date`                                       |
| `userId`          | uuid                  | FK → User                                                      |
| `date`            | date                  |                                                                |
| `scheduledCount`  | int                   | Number of routine instances scheduled that day in this section. **Drives the base-score denominator** (see §5.1). |
| `completedCount`  | int                   | Number completed (raw count, for tooltip display).              |
| `scheduledWeight` | **numeric(6, 2)**     | Sum of priority weights over scheduled instances (`Σ priorityWeight(instance.priority)`). Informational — used for the "would-be-max if all done" tooltip line. Not in the denominator (see §5.2). |
| `completedWeight` | **numeric(6, 2)**     | Sum of priority weights over completed instances. **Drives the base-score numerator.** |
| `score`           | **numeric(4, 3)**     | Signed; range **`[-1.000, +2.000]`** (extreme-only completed days can reach +2). Equals `baseScore` for routines (no Backlog modifier). Use exact decimal — `0.2 + 0.6` should equal `0.8` without float drift. |
| `runningTotal`    | **numeric(10, 3)**    | Cumulative across all earlier days for this section. Bounded by `[-days_observed, +2 * days_observed]` so 10 digits is plenty for any realistic horizon. |
| `computedAt`      | timestamptz           |                                                                |

`dated_section_daily_score`

Same shape as routine, **plus backlog-related columns** to record the dated-only modifier:

| Column                  | Type                  | Notes                                                          |
| ----------------------- | --------------------- | -------------------------------------------------------------- |
| `sectionId`             | uuid                  | Composite PK with `date`                                       |
| `userId`                | uuid                  | FK → User                                                      |
| `date`                  | date                  |                                                                |
| `scheduledCount`        | int                   | Single-day dated tasks for this section due that day (snapshot, see below). **Drives the base-score denominator** (see §5.1). |
| `completedCount`        | int                   | Of those, ones completed by end of day.                        |
| `scheduledWeight`       | **numeric(6, 2)**     | Sum of `priorityWeight(task.priority)` over the scheduled set, snapshotted at end of day. Informational. |
| `completedWeight`       | **numeric(6, 2)**     | Sum of `priorityWeight(task.priority)` over the completed subset. **Drives the base-score numerator.** |
| `backlogCount`          | int                   | Of those, ones that entered Backlog at end of day.              |
| `backlogTopPriority`    | enum (priority)?      | Priority of the highest-priority task that entered backlog that day. `NULL` when `backlogCount = 0`. Stored so the chart tooltip can read it without rejoining `Task`. |
| `baseScore`             | **numeric(4, 3)**     | Per §5.1, range **`[-1.000, +2.000]`**. Computed as `completedWeight / scheduledCount` with the -1 / 0 boundary rules. Stored separately so the breakdown is debuggable. |
| `backlogPenalty`        | **numeric(4, 3)**     | Geometric-decay penalty per §5.3, range `(-3.000, 0.000]`. Bounded — even 100 tasks entering Backlog produces a penalty asymptotically approaching -3. Function of `backlogCount` only; priority affects ordering, not magnitude. |
| `score`                 | **numeric(5, 3)**     | `baseScore + backlogPenalty`. Bounded to approximately **`[-4.000, +2.000]`** — worst case is `baseScore = -1` plus `backlogPenalty → -3`; best case is an all-extreme fully-completed day with no backlog (+2.0). |
| `runningTotal`          | **numeric(10, 3)**    | Cumulative across all earlier days for this section.           |
| `computedAt`            | timestamptz           |                                                                |

**Why both `scheduledCount` and `scheduledWeight`?** The count is now the denominator of the score formula (so it's load-bearing, not just for display). The weight is informational — it powers the tooltip's "max possible if all done" line and reserves the option to switch to a weight-based formula later (see §10) without a schema migration. Counts are also what users naturally read in the tooltip ("3 of 5 completed").

#### Nightly job ordering for the dated family

The nightly maintenance job (`Tasks.md` §5.5) runs steps in this strict order **per day** (so multi-day catch-up doesn't break the snapshot):

1. Materialize missing routine `TaskInstance` rows for yesterday (snapshotting each parent routine's current `priority` onto the new instance — see `Tasks.md` §3.3 / §3.6).
2. **Snapshot dated due-day counts for yesterday into `dated_section_daily_score`** for every Section that had any single-day dated task whose `startDate = yesterday` AND `inBacklog = false` at end of day. Compute:
    - `scheduledCount` / `scheduledWeight` (those tasks; weight = Σ `priorityWeight(task.priority)` at end-of-day). `scheduledCount` drives the base-score denominator (§5.1); `scheduledWeight` is informational.
    - `completedCount` / `completedWeight` (those with `completedAt <= yesterday_end_local`). `completedWeight` drives the base-score numerator.
    - `backlogCount` (those with `completedAt IS NULL AND transferredFromDate IS NOT NULL` — i.e. they were already transferred once, missed today, so the next step will move them to Backlog)
    - `backlogTopPriority` (max priority among the backlog set; NULL if `backlogCount = 0`)
    - `baseScore = completedWeight / scheduledCount` (with the -1 / 0 boundary rules per §5.1; range `[-1.000, +2.000]`), `backlogPenalty` (per §5.3 — geometric decay, count-driven), `score = baseScore + backlogPenalty`, `runningTotal`

    **This step must happen before step 3** — otherwise transfer would mutate `startDate` and `inBacklog`, and we'd lose the historical due-day information AND the ability to detect which tasks were transitioning into Backlog tonight.
3. Transfer / backlog missed dated tasks (`Tasks.md` §5.6) — actually mutate `startDate`, `transferredFromDate`, `inBacklog` based on the rule.
4. Compute routine daily scores for yesterday into `routine_section_daily_score`. For each Section, count the scheduled instances (`scheduledCount`), sum the priority weights of completed instances (`completedWeight`), and compute `score = completedWeight / scheduledCount` with the §5.1 boundary rules. Weights come from each instance's snapshot `priority` (Step 1). Routines have no backlog modifier.

Catch-up safety: when the job runs after multi-day downtime, it processes one day at a time (Steps 1→4 for day D before moving to day D+1). This preserves the Step 2 → Step 3 ordering for every snapshot.

### 5.5 Worked examples

The base score is identical across families; only the row sources differ. The Dated family adds the geometric-decay backlog penalty on top. Examples below use the priority weights `extreme = 2.0`, `high = 1.5`, `mid = 1.0`, `low = 0.5` and the mid-reference formula `completedWeight / scheduledCount` from §5.1.

**Routine, 7-day full-or-zero week (all `mid` priority — degrades to the un-weighted case):**

When every task is `mid`, `priorityWeight = 1.0` for everything and the formula collapses to plain `completed / scheduled`.

| Day | scheduledCount | completedCount | completedWeight | Daily Score | Running Total |
| --- | -------------- | -------------- | --------------- | ----------- | ------------- |
| 1   | 5              | 5              | 5.0             | 5.0 / 5 = **+1.000** | 1.000  |
| 2   | 5              | 5              | 5.0             | **+1.000** | 2.000          |
| 3   | 0              | —              | 0.0             | 0          | 2.000          |
| 4   | 5              | 0              | 0.0             | **-1.000** (floor) | 1.000  |
| 5   | 5              | 0              | 0.0             | **-1.000** | 0.000          |
| 6   | 5              | 5              | 5.0             | **+1.000** | 1.000          |
| 7   | 5              | 5              | 5.0             | **+1.000** | 2.000          |

**Routine, mixed priorities — the weighting matters:**

Each day has up to 5 routine instances of varying priority. The "Completed" column lists *which* priorities were completed.

| Day | Scheduled (priorities)    | Completed (priorities)       | scheduledCount | completedWeight | Daily Score                | Running Total |
| --- | ------------------------- | ---------------------------- | -------------- | --------------- | -------------------------- | ------------- |
| 1   | extreme×1, mid×3, low×1   | all 5 completed              | 5              | 2 + 3 + 0.5 = 5.5 | 5.5 / 5 = **+1.100**     | 1.100         |
| 2   | extreme×1, mid×3, low×1   | extreme + 2 mid (3 of 5)     | 5              | 2 + 2 = 4.0     | 4.0 / 5 = **+0.800**       | 1.900         |
| 3   | extreme×1, mid×3, low×1   | only the low (1 of 5)        | 5              | 0.5             | 0.5 / 5 = **+0.100**       | 2.000         |
| 4   | extreme×1, mid×3, low×1   | none                         | 5              | 0.0             | **-1.000** (floor)         | 1.000         |
| 5   | 0                         | —                            | 0              | 0.0             | 0                          | 1.000         |
| 6   | mid×2, low×3              | 2 mid + 1 low (3 of 5)       | 5              | 2 + 0.5 = 2.5   | 2.5 / 5 = **+0.500**       | 1.500         |
| 7   | extreme×2, high×2, mid×1  | all 5 completed              | 5              | 4 + 3 + 1 = 8.0 | 8.0 / 5 = **+1.600** ← *extreme day*  | 3.100 |

A few things to notice:
- Day 1 scores **+1.100** (not +1.000) because the one `extreme` in the schedule overcompensates for the one `low`, pushing a full-completion day slightly above the mid baseline.
- Day 3 (only the low completed) scores **+0.100** — a tiny positive nod for at least doing *something*, while honestly logging that the impactful tasks were missed.
- Day 7's **+1.600** is the headline: a day genuinely full of extreme work, fully completed, sails well above any mid day.
- Day 6 is the interesting case for low-heavy schedules: even though you completed 3 of 5, the score is only +0.500 because those 3 completions summed to only 2.5 weight. A day of "I finished 60% of mostly-low-priority work" is honestly less impactful than a mid-equivalent +0.6 day.

**Dated, illustrated example (the user's diagram — single backlog event, all `mid` for simplicity):**

Consider one Section across three days. All single-day dated tasks are `mid` priority and have `transferIfMissed = true`.

| Day | Tasks                                       | Completed       | Backlog event              | scheduledCount | completedWeight | baseScore             | backlogPenalty | dayScore   |
| --- | ------------------------------------------- | --------------- | -------------------------- | -------------- | --------------- | --------------------- | -------------- | ---------- |
| 1   | Task 1, Task 2, Task 3 (all mid)            | Task 1, Task 2  | none (Task 3 transfers)    | 3              | 2.0             | 2.0 / 3 = **+0.667**  | 0              | **+0.667** |
| 2   | Task 1 (new mid), Task 3 (transferred mid)  | Task 1          | Task 3 → backlog tonight   | 2              | 1.0             | 1.0 / 2 = **+0.500**  | N=1 → -2.0     | **-1.500** |
| 3   | Task 1, Task 2 (both mid)                   | Task 1, Task 2  | none                       | 2              | 2.0             | 2.0 / 2 = **+1.000**  | 0              | **+1.000** |

All-mid days collapse to the simple completed-of-scheduled ratio, so this example is identical to a world without priority. Running total ends at `+0.167`.

Mapping to the user's mental model for Day 2: *"0.5 from the day's completion ratio, then -1 for not completing the transferred task and another -1 for it moving to backlog."* The two -1s combine into the single-task backlog penalty of -2.

**Dated, same shape but with priorities shifting the picture:**

Same three-day scenario, but now Task 3 (the one that ends up in backlog) is `extreme`, and Task 1 on Day 2 is `low`.

| Day | Tasks                                            | Completed       | Backlog event              | scheduledCount | completedWeight | baseScore                | backlogPenalty | dayScore   |
| --- | ------------------------------------------------ | --------------- | -------------------------- | -------------- | --------------- | ------------------------ | -------------- | ---------- |
| 1   | Task 1 (mid), Task 2 (mid), Task 3 (extreme)     | Task 1, Task 2  | none (Task 3 transfers)    | 3              | 2.0             | 2.0 / 3 = **+0.667**     | 0              | **+0.667** |
| 2   | Task 1 (low, new), Task 3 (extreme, transferred) | Task 1 (low)    | Task 3 (extreme) → backlog | 2              | 0.5             | 0.5 / 2 = **+0.250**     | N=1 → -2.0     | **-1.750** |
| 3   | Task 1 (extreme), Task 2 (extreme)               | Task 1, Task 2  | none                       | 2              | 4.0             | 4.0 / 2 = **+2.000** ← *extreme day* | 0    | **+2.000** |

Running total ends at `0.917`. Notice:
- Day 1 scores the same +0.667 as the all-mid version — base scoring doesn't differentially punish missing extreme on its own (that's the Backlog penalty's job).
- Day 2 dips slightly deeper (-1.750 vs -1.500) because completing only the *low* task while missing the *extreme* scores a lower base (+0.250 vs +0.500).
- Day 3 soars to **+2.000** because completing two extreme tasks is genuinely twice as impactful as completing two mids — the chart line will visibly punch up on this day.
- The Backlog penalty itself is still -2 regardless of which priority hit backlog (the priority just ordered Task 3 to take the -2 term, since it was the only one).

**Dated, multi-backlog day (geometric decay in action, priorities mixed):**

After yesterday's transfers, today has 5 single-day dated tasks all already-transferred (so each is now on its second-and-final day). Priorities: 1 extreme, 1 high, 2 mid, 1 low. End of day: you complete zero of them — all 5 enter Backlog tonight.

| | Value |
| --- | --- |
| `scheduledCount` | 5 |
| `completedCount` | 0 |
| `scheduledWeight` | 2 + 1.5 + 1 + 1 + 0.5 = **6.0** (informational; tooltip shows max-possible = 6.0/5 = +1.2) |
| `completedWeight` | **0.0** |
| `backlogCount`   | 5 |
| `backlogTopPriority` | `extreme` (drives the -2 term in the decay) |
| `baseScore`      | **-1.000** (zero completed → -1 floor; floor doesn't scale with weight) |
| `backlogPenalty` | -3 + (1/2)^4 = -3 + 0.0625 = **-2.9375** (count-driven; priorities only sort the order in which decay terms are *assigned* to tasks — extreme takes -2, high takes -0.5, mid takes -0.25, mid takes -0.125, low takes -0.0625) |
| `score`          | **-3.9375** |

Five tasks falling into Backlog on the same day is a sharp drop — bounded just above -4. The priority ordering of the per-task decay terms is informational (it powers the tooltip: "5 tasks → backlog: 1 extreme, 1 high, 2 mid, 1 low") but does not change the total penalty.

**Dated, more involved week (mixed priorities):**

| Day | Scheduled (snapshot — priorities)            | Completed              | Backlog                       | scheduledCount | completedWeight | baseScore                  | backlogPenalty | dayScore   |
| --- | --------------------------------------------- | ---------------------- | ----------------------------- | -------------- | --------------- | -------------------------- | -------------- | ---------- |
| Mon | PR (high), landlord (mid)                     | PR                     | 0                             | 2              | 1.5             | 1.5 / 2 = **+0.750**       | 0              | **+0.750** |
| Tue | landlord (mid, transferred), passport (high)  | passport               | landlord → backlog (mid)      | 2              | 1.5             | 1.5 / 2 = **+0.750**       | N=1 → -2.0     | **-1.250** |
| Wed | (nothing scheduled)                           | —                      | 0                             | 0              | 0.0             | 0                          | 0              | **0**      |
| Thu | Q3 prep (extreme)                             | Q3 prep                | 0                             | 1              | 2.0             | 2.0 / 1 = **+2.000** ← *extreme day* | 0    | **+2.000** |
| Fri | timesheet (low)                               | 0                      | 0 (timesheet transfers)       | 1              | 0.0             | **-1.000** (floor)         | 0              | **-1.000** |
| Sat | timesheet (low)                               | timesheet              | 0                             | 1              | 0.5             | 0.5 / 1 = **+0.500**       | 0              | **+0.500** |

Week's cumulative: `+0.75 - 1.25 + 0 + 2.0 - 1.0 + 0.5 = +1.000`. The week ends positive primarily because of Thursday's extreme completion. Saturday's `+0.500` for completing the low-priority timesheet is honest: getting the routine admin done isn't a chart-shaping day.

Two things to notice:
- A task can contribute negative scores on **two consecutive days** (its original miss day and its transferred miss day) — that's honest. "Reply to landlord" lowered both Mon (via the base score, where it took up part of the missed weight) and Tue (via the base score AND the backlog penalty).
- The Backlog state itself does not create chart entries on subsequent days — backlogged tasks contribute only via the day they were last due. Wednesday has `scheduledCount = 0` for this section despite a task being IN the backlog.

---

## 6. Behavior

### 6.1 Data fetching

Three endpoints, one per chart block type:

- `GET /v1/charts/routine/global?from=...&to=...` — global Routine aggregate.
- `GET /v1/charts/dated/global?from=...&to=...` — global Dated aggregate.
- `GET /v1/sections/{id}/dated-stats?from=...&to=...` — one Section's Dated family.

Each returns:
- `series`: array of `{ date, scheduledCount, completedCount, scheduledWeight, completedWeight, baseScore?, backlogPenalty?, backlogCount?, backlogTopPriority?, score, runningTotal }` over the range — drives the time-series chart in §4. Counts and weights are included so the hover tooltip can show the full breakdown without an extra round-trip. `baseScore`, `backlogPenalty`, `backlogCount`, and `backlogTopPriority` are only included for the Dated family; the Routine family just has `score` (which equals `baseScore` because there's no Backlog penalty for routines).

#### Per-Section vs. global — how globals are computed

- **Per-Section Dated** reads directly from `dated_section_daily_score` (`WHERE sectionId = :id AND date BETWEEN :from AND :to`).
- **Global Dated** is computed by aggregating the per-Section rows: `SUM(scheduledCount)`, `SUM(completedCount)`, `SUM(scheduledWeight)`, `SUM(completedWeight)`, `SUM(backlogCount)` grouped by `date`, then **the §5.1 formula is re-applied to the day's global totals** — `globalBaseScore = SUM(completedWeight) / SUM(scheduledCount)` with the §5.1 boundary rules — *not* averaged from per-Section scores. (Averaging would give wrong results: a Section with 3-of-5 mids done (`+0.6`) and a Section with 0-of-2 mids done (`-1.0`) yields global `3.0 / 7 ≈ +0.429` base, not the average `(0.6 + -1)/2 = -0.2`.) The mid-as-reference property holds at the global level too: a section completing 2 extreme tasks on a day where everything else is mid will pull the global score above +1. The backlog penalty for the global series is `backlogPenalty(SUM(backlogCount))` — recomputed from the global count, not summed from per-Section penalties (since the geometric decay is non-linear). The running total is computed cumulatively from those re-derived global daily scores. `backlogTopPriority` for the global series is the maximum across all Sections' `backlogTopPriority` for that day.
- **Global Routine** is computed the same way from `routine_section_daily_score` (without the backlog penalty since routines have none).

Both global series can also be persisted into helper tables (`routine_global_daily_score`, `dated_global_daily_score`) if the on-the-fly aggregation becomes a hot path; for v1 personal-scale data it's a cheap GROUP BY and is computed at read time.

#### Caching

TanStack Query caches per `(chartType, scope, range)` — where `scope = "global"` or `sectionId`, and `chartType ∈ {routine, dated}`. Toggling today's completion optimistically updates the rightmost data point of every chart that includes that task (its Section's chart AND the global chart of the same family), but does **not** mutate the cumulative line — that only changes when the nightly job runs (or on demand if a past instance / task is edited).

### 6.2 Live updates
- Ticking today's routine instance or today's dated task optimistically updates today's marker on every relevant chart block (per-Section dated for that Section + both globals).
- No WebSocket; updates ride on the existing query invalidation pattern (see `PROJECT.md` §2.1, TanStack Query).

### 6.3 Performance
- For a user with ~10 routines, ~10 active dated tasks, and ~5 sections, each per-Section payload is small (≤365 daily rows ≈ ~15 KB JSON). Global payloads are the same size (one row per day after aggregation). No pagination or virtualization needed in v1.
- Reads hit the precomputed `*_section_daily_score` tables (see §5.4), so they're O(rows-in-range) with no joins to `TaskInstance` or `Task`. The nightly job absorbs all the per-Section aggregation work once per day; global aggregation is a single GROUP BY over the per-Section rows.

### 6.4 Loading / error states
- Loading: skeleton with correct chart dimensions (no layout jump).
- Error: small inline banner above the chart with a retry button. Other charts on the page and the task lists below them are unaffected.

---

## 7. API surface (sketch — full shape goes in `PROJECT.md` §7)

| Method | Path                                              | Purpose                                                                  |
| ------ | ------------------------------------------------- | ------------------------------------------------------------------------ |
| GET    | `/v1/charts/routine/global?from=...&to=...`       | Global Routine cumulative-score time-series, aggregated across all Sections |
| GET    | `/v1/charts/dated/global?from=...&to=...`         | Global Dated cumulative-score time-series, aggregated across all Sections   |
| GET    | `/v1/sections/{id}/dated-stats?from=...&to=...`   | Per-Section Dated cumulative-score time-series                              |

The Section list, individual routine / task data, and `TaskInstance` toggling already come from `Tasks.md` §7 endpoints. (A per-Section Routine endpoint can be added later if we ever expose per-Section routine charts — see §3.5.)

---

## 8. Accessibility

- Time-series chart: chart has a text alternative summarizing trend (e.g. "Dated completion trending down over the last 30 days; 2 backlog events in this period; one entered as extreme priority"). Hover tooltip is also keyboard-accessible (arrow keys move the crosshair day-by-day; Enter announces the day's full breakdown).
- Color is never the sole indicator — chart values are visible on hover; Backlog penalty days are called out in tooltip text (including the top backlog priority) as well as via a visual cliff in the line.
- Priority badges on individual tasks (in tooltips and elsewhere) carry both a glyph and a text label (`▲▲ extreme`), never color alone — see `Tasks.md` §3.6.
- Respects `prefers-reduced-motion` (no chart line animations on update).
- Each chart block has a clear `aria-label` distinguishing family and scope, e.g. `"Global routine consistency"`, `"Global dated completion"`, `"Dated completion: Workout"` — so they're not confused for each other.

---

## 9. Dependencies

- **Tasks** (`Features Markdown/Tasks.md`) — `TaskInstance` rows feed the routine charts; single-day dated task lifecycle (including transfer / backlog) feeds the dated charts. Section accent color flows through (`Tasks.md` §3.1). Task `priority` (`Tasks.md` §3.6) drives the weighted scoring and the backlog penalty's per-task ordering.
- **Nightly maintenance job** (`Tasks.md` §5.5) — strict ordering rule (§5.3 / §5.4) is required for the dated chart's honest history. The job also snapshots `priority` weights onto routine instances at materialisation time, and into the dated snapshot table at end-of-day; this is what keeps historical scores stable when the user later edits a task's priority.
- **Recharts** — for the v1 line chart.
- **date-fns** — for date arithmetic and tooltip date formatting.
- Section accent colors (`Tasks.md` §3.1).
- Priority badge palette (`Tasks.md` §3.6) — re-used in tooltips and the backlog-penalty annotation.

---

## 10. Open Questions / TODOs

- Time-series default range: 90 days vs 30 days. Leaning 90 (with dashboard widget variants defaulting to 30).
- Time-series chart library: stay on **Recharts** for v1 line chart; only re-evaluate (e.g. `lightweight-charts`) if/when we add candlesticks or volume bars.
- Empty state: when the global Routine or Dated chart has no data yet (brand-new account), what does the top-of-page chart panel look like? Leaning toward a friendly "Add a routine / add a dated task to see your consistency chart fill in." with `+ New routine` / `+ New dated task` CTAs.
- **Per-Section Routine charts** — explicitly out of v1 per §2 Non-Goals + §3.5. The underlying data is computed, so re-enabling them later is a UI-only change. Worth re-evaluating after a few months of use.
- **Per-task overlay on the time-series** — defer.
- **Snapshot semantics for dated tasks under edits.** If the user edits a past dated task's `startDate` from Tue → Wed weeks later, do we recompute the dated chart from Tue forward? Probably yes (analogous to routine on-demand recompute), but UI implications need thinking through.
- **Resilience to long catch-ups.** If the nightly job hasn't run for many days (laptop closed), the first run after returning must process each day in order so the dated-chart snapshot step (Step 2) happens *before* that day's transfer step (Step 3 — see `Tasks.md` §5.5). The job is implemented day-by-day, not "do all snapshots then all transfers."
- **Global Dated chart breakdown.** Should the global Dated time-series tooltip show a per-Section breakdown of the day's backlog events ("3 backlog events: Work (1), Personal (2)")? Nice for debugging "where am I leaking?" but adds tooltip complexity. Defer.
- **Persisted vs. computed-at-read globals.** §6.1 computes global daily scores at read time via GROUP BY. If this becomes slow, materialize into `routine_global_daily_score` / `dated_global_daily_score` tables refreshed by the nightly job. No urgency at v1 scale.
- **Priority weights are hard-coded.** v1 uses `extreme=2.0 / high=1.5 / mid=1.0 / low=0.5` (§5.1). Should they be a user setting? Probably not — the whole point is that the dial is objective. Re-evaluate after a few months of use. The choice of `mid = 1.0` ensures the chart degrades gracefully for users who put everything at `mid` (the formula collapses to `completed/scheduled`).
- **Mid-as-reference denominator vs pure weighted ratio.** v1 uses `completedWeight / scheduledCount` (mid-reference, §5.1) so the daily ceiling expands above +1 for extreme-heavy days. The alternative `completedWeight / scheduledWeight` (pure weighted ratio) would cap every day at +1 but make missing extremes hurt proportionally more in the base score itself. Decision: mid-reference for v1 because *visibly rewarding extreme completion* was the user's primary intent. If the chart's expanded Y-axis becomes hard to read, revisit. The schema stores both `scheduledCount` and `scheduledWeight` so a future switch is a recompute, not a migration.
- **Multiplicative backlog penalty by priority.** v1 penalises backlog events by count-driven geometric decay, with priority only affecting the *order* in which decay terms are assigned to tasks (§5.3). A more aggressive variant would multiply each term by `priorityWeight(task)` — making a single extreme backlog `-2 * 2.0 = -4` and pushing the day's floor below -5. Decision: keep the bounded `[-4, +2]` Dated Y-axis for v1; revisit only if the chart feels too forgiving for extreme losses.
- **Tooltip backlog priority detail.** The tooltip currently shows `backlogTopPriority` (the worst-priority task in the backlog set that day). Should it also list the full priority breakdown ("1 extreme, 1 high, 2 mid, 1 low")? Useful for diagnosing bad days, but adds tooltip noise. Defer; the dashboard widget probably wants the compact form anyway.
- **Edge case: priority changes between days.** If a routine's `priority` changes on Day N, instances created before Day N keep their snapshotted priority and instances from Day N onwards use the new one. The chart will show a slight "before/after" inflection — that's the desired honest history. Document this in the routine edit UI as a footnote.

---

## 11. Future Work (deferred from v1)

The following were considered for v1 but explicitly deferred. All are pure additions to what's specced above and require no schema migration to enable later.

### 11.1 Completion heatmap visual

A GitHub-contributions-style 7-row × N-column grid of square cells, one cell per day, color intensity scaling with that day's completion ratio. Originally specced alongside the time-series line chart but removed from v1 to keep each chart block to one visual.

**Why it was removed:** redundant signal density alongside the cumulative line chart for a personal-scale app — the user can already read "how was today?" from the rightmost point of the line, and the heatmap's grid eats vertical space that's better used for the line's own range. The data behind it (`scheduledCount`, `completedCount`, `scheduledWeight`, `completedWeight`, `backlogCount` per day) is already stored and returned by the API, so re-enabling the visual is purely a frontend addition.

**If/when added back:**
- Rolling 365-day range, 7 rows × 52 columns, cell intensity = `completedWeight / scheduledWeight` mapped to 5 buckets (0% → 1–25% → 26–50% → 51–75% → 76–100%).
- Intensity uses **weight/weight** (pure completion %, bounded `[0, 1]`) so cell color stays intuitive — "how much of what I planned did I do?" — separately from the line chart's score (which is `weight/count` and can exceed 1.0). A fully-completed extreme day and a fully-completed low day would both show the darkest cell (both 100% complete) but produce very different scores on the line chart (+2 vs +0.5).
- Section accent color for the cell palette; greyscale for "nothing scheduled" cells.
- Hover tooltip with day, completion fraction, and per-task badges.
- For Dated cells, a distinct visual treatment (extra dark / red border) for days that include a Backlog event.
- Heatmap would render *above* the line chart in each block, sharing the same width.
- Open question that follows from bringing it back: tunable color buckets, and whether the dashboard widget version trims to the most recent ~12 weeks for compactness.

### 11.2 Volume-style bars

Bar overlay below the line chart showing scheduled-task count per day — a stock-chart-style "trading volume" visual. Useful for spotting "busy days where I still scored well" vs "light days that happened to score well." Re-evaluate alongside heatmap.

### 11.3 Candlestick aggregation

Weekly / monthly OHLC-style candles for the line chart, replacing the line at coarser time ranges (1Y / All). Would require switching from Recharts to `lightweight-charts` (TradingView's open-source library). Out of v1 — the simple line is enough at personal data scales.
