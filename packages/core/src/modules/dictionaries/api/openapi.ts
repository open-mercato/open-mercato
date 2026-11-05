import { z } from 'zod'
import {
  upsertDictionarySchema,
  createDictionaryEntrySchema,
  updateDictionaryEntrySchema,
  reorderDictionaryEntriesSchema,
  setDefaultDictionaryEntrySchema,
  DICTIONARY_ENTRIES_MAX_LIMIT,
} from '@open-mercato/core/modules/dictionaries/data/validators'
import { dictionaryEntrySortModeSchema } from '@open-mercato/core/modules/dictionaries/lib/entrySort'

export const dictionariesTag = 'Dictionaries'

export const dictionariesErrorSchema = z.object({
  error: z.string(),
}).passthrough()

export const dictionariesOkSchema = z.object({
  ok: z.literal(true),
})

export const dictionaryListQuerySchema = z.object({
  includeInactive: z.enum(['true', 'false']).optional(),
})

export const dictionarySchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  isActive: z.boolean(),
  managerVisibility: z.string().nullable().optional(),
  entrySortMode: dictionaryEntrySortModeSchema.optional(),
  organizationId: z.string().uuid().nullable(),
  isInherited: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
})

export const dictionaryListResponseSchema = z.object({
  items: z.array(dictionarySchema),
})

export const dictionaryDetailSchema = dictionarySchema

export const dictionaryEntrySchema = z.object({
  id: z.string().uuid(),
  value: z.string(),
  label: z.string(),
  color: z.string().nullable(),
  icon: z.string().nullable(),
  position: z.number(),
  isDefault: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
})

export const dictionaryEntryListResponseSchema = z.object({
  items: z.array(dictionaryEntrySchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
  hasMore: z.boolean(),
  sortMode: dictionaryEntrySortModeSchema.describe(
    'Sort mode that ordered this page. Clients assembling multiple pages must re-apply it across the combined set.',
  ),
})

export const dictionaryEntriesQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(DICTIONARY_ENTRIES_MAX_LIMIT)
    .optional()
    .describe(`Maximum entries to return. Defaults to and is capped at ${DICTIONARY_ENTRIES_MAX_LIMIT}.`),
  offset: z.coerce.number().int().min(0).optional().describe('Number of entries to skip. Defaults to 0.'),
})

export const dictionaryEntryResponseSchema = dictionaryEntrySchema

export const dictionaryIdParamsSchema = z.object({
  dictionaryId: z.string().uuid(),
})

export const dictionaryEntryParamsSchema = z.object({
  dictionaryId: z.string().uuid(),
  entryId: z.string().uuid(),
})

export const dictionaryUpdateSchema = upsertDictionarySchema.partial()

export const reorderEntriesRequestSchema = z.object({
  entries: z.array(z.object({
    id: z.string().uuid(),
    position: z.number().int().min(0),
  })).min(1),
})

export const setDefaultEntryRequestSchema = z.object({
  entryId: z.string().uuid(),
})

export {
  upsertDictionarySchema,
  createDictionaryEntrySchema,
  updateDictionaryEntrySchema,
  reorderDictionaryEntriesSchema,
  setDefaultDictionaryEntrySchema,
}
