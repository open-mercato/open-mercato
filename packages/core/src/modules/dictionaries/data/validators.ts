import { z } from 'zod'
import { dictionaryEntrySortModeSchema } from '../lib/entrySort'

// Modules own their system dictionaries under a namespace segment (`resources.capacity_unit`,
// `sales.shipment_status`, `planner.unavailability-reasons.staff`) and seed those rows straight
// through the EntityManager, so the API has to accept the same shape its own modules emit.
// Each dot-separated segment still obeys the slug rule, which keeps leading/trailing/repeated
// dots out. Nothing downstream splits or escapes a key — dictionaries are addressed by id in
// every route — so the extra separator carries no meaning beyond grouping.
export const DICTIONARY_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*)*$/

export const dictionaryKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(DICTIONARY_KEY_PATTERN, 'Use lowercase letters, numbers, hyphen, underscore, or a dot between segments.')

const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#([0-9a-fA-F]{6})$/, 'Color must be a valid six-digit hex code like #3366ff')

const iconSchema = z.string().trim().min(1).max(64)

export const upsertDictionarySchema = z.object({
  key: dictionaryKeySchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  isSystem: z.boolean().optional(),
  isActive: z.boolean().optional(),
  entrySortMode: dictionaryEntrySortModeSchema.optional(),
})

export type UpsertDictionaryInput = z.infer<typeof upsertDictionarySchema>

export const DICTIONARY_ENTRIES_MAX_LIMIT = 500

export const listDictionaryEntriesQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(DICTIONARY_ENTRIES_MAX_LIMIT)
    .catch(DICTIONARY_ENTRIES_MAX_LIMIT),
  offset: z.coerce.number().int().min(0).catch(0),
})

export type ListDictionaryEntriesQuery = z.infer<typeof listDictionaryEntriesQuerySchema>

export const createDictionaryEntrySchema = z.object({
  value: z.string().trim().min(1).max(150),
  label: z.string().trim().min(1).max(150).optional(),
  color: hexColorSchema.nullable().optional(),
  icon: iconSchema.nullable().optional(),
  position: z.number().int().min(0).optional(),
})

export type CreateDictionaryEntryInput = z.infer<typeof createDictionaryEntrySchema>

const dictionaryEntryUpdateFieldsSchema = z.object({
  value: z.string().trim().min(1).max(150).optional(),
  label: z.string().trim().min(1).max(150).optional(),
  color: hexColorSchema.nullable().optional(),
  icon: iconSchema.nullable().optional(),
  position: z.number().int().min(0).optional(),
  isDefault: z.boolean().optional(),
})

const validateDictionaryEntryUpdate = (payload: z.infer<typeof dictionaryEntryUpdateFieldsSchema>) =>
  Object.keys(payload).length > 0

export const updateDictionaryEntrySchema = dictionaryEntryUpdateFieldsSchema.refine(
  validateDictionaryEntryUpdate,
  {
    message: 'Provide at least one field to update.',
  },
)

export type UpdateDictionaryEntryInput = z.infer<typeof updateDictionaryEntrySchema>

export const dictionaryEntryCommandCreateSchema = createDictionaryEntrySchema.extend({
  dictionaryId: z.string().uuid(),
})

export type DictionaryEntryCommandCreateInput = z.infer<typeof dictionaryEntryCommandCreateSchema>

export const dictionaryEntryCommandUpdateSchema = z
  .object({
    id: z.string().uuid(),
  })
  .merge(dictionaryEntryUpdateFieldsSchema)
  .refine(validateDictionaryEntryUpdate, {
    message: 'Provide at least one field to update.',
  })

export type DictionaryEntryCommandUpdateInput = z.infer<typeof dictionaryEntryCommandUpdateSchema>

export const reorderDictionaryEntriesSchema = z.object({
  entries: z.array(z.object({
    id: z.string().uuid(),
    position: z.number().int().min(0),
  })).min(1),
})

export type ReorderDictionaryEntriesInput = z.infer<typeof reorderDictionaryEntriesSchema>

export const reorderDictionaryEntriesCommandSchema = reorderDictionaryEntriesSchema.extend({
  dictionaryId: z.string().uuid(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
})

export type ReorderDictionaryEntriesCommandInput = z.infer<typeof reorderDictionaryEntriesCommandSchema>

export const setDefaultDictionaryEntrySchema = z.object({
  entryId: z.string().uuid(),
})

export type SetDefaultDictionaryEntryInput = z.infer<typeof setDefaultDictionaryEntrySchema>

export const setDefaultDictionaryEntryCommandSchema = setDefaultDictionaryEntrySchema.extend({
  dictionaryId: z.string().uuid(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
})

export type SetDefaultDictionaryEntryCommandInput = z.infer<typeof setDefaultDictionaryEntryCommandSchema>
