import { z } from 'zod'
import {
  upsertDictionarySchema,
  createDictionaryEntrySchema,
  updateDictionaryEntrySchema,
} from '@open-mercato/core/modules/dictionaries/data/validators'

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
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
})

export const dictionaryEntryListResponseSchema = z.object({
  items: z.array(dictionaryEntrySchema),
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

export {
  upsertDictionarySchema,
  createDictionaryEntrySchema,
  updateDictionaryEntrySchema,
}

