-- Make sectionId nullable on both daily-score tables so Inbox tasks
-- (sectionId = NULL on `Task`) participate in scores instead of being
-- silently dropped from the nightly job.
--
-- Prisma can't express `NULLS NOT DISTINCT` in schema syntax (lands in
-- Prisma 8 per #3387), so this file is hand-written. Shape matches the
-- existing `20260614202307_focus_session_partial_unique` migration — see
-- that file + the schema.prisma header comment for the convention.
--
-- Spec cross-refs:
--   * Tasks.md §3.4  — "sectionId = NULL means the implicit Inbox"
--   * TaskCharts.md §3.3 — inbox should appear in global charts
--   * PROJECT.md §5 RoutineSectionDailyScore / DatedSectionDailyScore
--
-- Composite PKs can't contain nullable columns in Postgres, so we move to
-- a surrogate `id` PK and enforce semantic uniqueness with a partial
-- unique index that uses NULLS NOT DISTINCT.

-- ---------------------------------------------------------------------------
-- routine_section_daily_score
-- ---------------------------------------------------------------------------

ALTER TABLE "routine_section_daily_score"
  DROP CONSTRAINT "routine_section_daily_score_pkey";

ALTER TABLE "routine_section_daily_score"
  ALTER COLUMN "sectionId" DROP NOT NULL;

ALTER TABLE "routine_section_daily_score"
  ADD COLUMN "id" TEXT;

-- Backfill `id` for any pre-existing rows. Uses gen_random_uuid() as a
-- cheap unique generator; prisma-cuid would be nicer but the server side
-- is the only writer going forward, and existing rows will get rewritten
-- on the next nightly run anyway.
UPDATE "routine_section_daily_score"
   SET "id" = gen_random_uuid()::text
 WHERE "id" IS NULL;

ALTER TABLE "routine_section_daily_score"
  ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE "routine_section_daily_score"
  ADD CONSTRAINT "routine_section_daily_score_pkey" PRIMARY KEY ("id");

CREATE UNIQUE INDEX "routine_section_daily_score_user_section_date_unique"
  ON "routine_section_daily_score" ("userId", "sectionId", "date")
  NULLS NOT DISTINCT;

-- ---------------------------------------------------------------------------
-- dated_section_daily_score
-- ---------------------------------------------------------------------------

ALTER TABLE "dated_section_daily_score"
  DROP CONSTRAINT "dated_section_daily_score_pkey";

ALTER TABLE "dated_section_daily_score"
  ALTER COLUMN "sectionId" DROP NOT NULL;

ALTER TABLE "dated_section_daily_score"
  ADD COLUMN "id" TEXT;

UPDATE "dated_section_daily_score"
   SET "id" = gen_random_uuid()::text
 WHERE "id" IS NULL;

ALTER TABLE "dated_section_daily_score"
  ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE "dated_section_daily_score"
  ADD CONSTRAINT "dated_section_daily_score_pkey" PRIMARY KEY ("id");

CREATE UNIQUE INDEX "dated_section_daily_score_user_section_date_unique"
  ON "dated_section_daily_score" ("userId", "sectionId", "date")
  NULLS NOT DISTINCT;
