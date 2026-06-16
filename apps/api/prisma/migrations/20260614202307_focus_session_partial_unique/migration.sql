-- Partial unique index: at most one active (running OR paused) FocusSession per user.
--
-- Prisma's schema syntax can't express partial uniqueness directly, so this
-- migration was created with `prisma migrate dev --create-only` and the SQL
-- hand-written. See FocusSession.md §3.1 and the file header comment in
-- prisma/schema.prisma for the rationale.

CREATE UNIQUE INDEX "FocusSession_userId_active_unique"
  ON "FocusSession" ("userId")
  WHERE state IN ('running', 'paused');
