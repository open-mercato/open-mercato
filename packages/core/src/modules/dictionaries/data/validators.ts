import { z } from 'zod'

export const dictionaryKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Use lowercase letters, numbers, hyphen, or underscore.')

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
})

export type UpsertDictionaryInput = z.infer<typeof upsertDictionarySchema>

export const createDictionaryEntrySchema = z.object({
  value: z.string().trim().min(1).max(150),
  label: z.string().trim().min(1).max(150).optional(),
  color: hexColorSchema.nullable().optional(),
  icon: iconSchema.nullable().optional(),
})

export type CreateDictionaryEntryInput = z.infer<typeof createDictionaryEntrySchema>

const dictionaryEntryUpdateFieldsSchema = z.object({
  value: z.string().trim().min(1).max(150).optional(),
  label: z.string().trim().min(1).max(150).optional(),
  color: hexColorSchema.nullable().optional(),
  icon: iconSchema.nullable().optional(),
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
