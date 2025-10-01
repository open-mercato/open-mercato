import { z } from 'zod'
import { CUSTOM_FIELD_KINDS } from '@open-mercato/shared/modules/custom_fields/kinds'

export const entityIdRegex = /^[a-z0-9_]+:[a-z0-9_]+$/

export const upsertCustomEntitySchema = z.object({
  entityId: z.string().regex(entityIdRegex, 'Expected <module>:<entity> (snake_case)'),
  label: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  labelField: z.string().min(1).max(100).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/).optional(),
  defaultEditor: z.enum(['markdown','simpleMarkdown','htmlRichText']).optional(),
  isActive: z.boolean().optional(),
})

export const upsertCustomFieldDefSchema = z.object({
  entityId: z.string().regex(entityIdRegex),
  key: z.string().min(1).max(100).regex(/^[a-z0-9_]+$/, 'snake_case only'),
  kind: z.enum(CUSTOM_FIELD_KINDS),
  configJson: z.any().optional(),
  isActive: z.boolean().optional(),
})

export type UpsertCustomEntityInput = z.infer<typeof upsertCustomEntitySchema>
export type UpsertCustomFieldDefInput = z.infer<typeof upsertCustomFieldDefSchema>
