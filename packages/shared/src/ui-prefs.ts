// `/v1/me/ui-prefs` contract: cosmetic per-user picks (life grid palette +
// size, priority colors + icons) synced across devices. Stored as one JSONB
// blob on `User.uiPrefs`; each top-level key is owned by one web store.
//
// PATCH merges at the top level (a sent key replaces that whole slice,
// omitted keys are untouched), so the stores never clobber each other.
// Every slice is optional + partial — the client merges over its defaults.

import { z } from 'zod';
import { HEX_COLOR_REGEX } from './milestones.js';

const hex = z.string().regex(HEX_COLOR_REGEX);
const priorityMap = <T extends z.ZodTypeAny>(v: T) =>
  z.object({ low: v, mid: v, high: v, extreme: v }).partial().strict();

export const LIFE_SIZES = ['s', 'm', 'l', 'xl'] as const;

export const uiPrefsSchema = z
  .object({
    // Role names (lived, h1, m3, …) are owned by the web app; the server
    // only bounds the shape so the blob can't grow unbounded.
    lifeColors: z
      .record(z.string().regex(/^[A-Za-z0-9]{1,16}$/), hex)
      .refine((o) => Object.keys(o).length <= 32, 'too many roles'),
    lifeSize: z.enum(LIFE_SIZES),
    priorityColors: priorityMap(hex),
    // Lucide component names; the web allow-list sanitizes unknown ones.
    priorityIcons: priorityMap(z.string().regex(/^[A-Za-z0-9]{1,32}$/)),
  })
  .partial()
  .strict();
export type UiPrefs = z.infer<typeof uiPrefsSchema>;
