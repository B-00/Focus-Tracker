-- Cross-device cosmetic prefs (life palette + size, priority colors + icons).
-- Shape validated by `uiPrefsSchema` in packages/shared/src/ui-prefs.ts.
ALTER TABLE "User" ADD COLUMN "uiPrefs" JSONB NOT NULL DEFAULT '{}';
