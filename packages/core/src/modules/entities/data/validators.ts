import { z } from 'zod'
import { CUSTOM_FIELD_KINDS } from '@open-mercato/shared/modules/entities/kinds'
import { validationRulesArraySchema } from '@open-mercato/shared/modules/entities/validation'

export const entityIdRegex = /^[a-z0-9_]+:[a-z0-9_]+$/

export const upsertCustomEntitySchema = z.object({
  entityId: z.string().regex(
    entityIdRegex,
    'Enter the entity id in the format: module_name:entity_id with your prefered entity and module names'
  ),
  label: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  labelField: z.string().min(1).max(100).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/).optional(),
  defaultEditor: z.enum(['markdown','simpleMarkdown','htmlRichText']).optional(),
  showInSidebar: z.boolean().default(false),
  isActive: z.boolean().optional(),
})

export const upsertCustomFieldDefSchema = z.object({
  entityId: z.string().regex(entityIdRegex),
  key: z.string().min(1).max(100).regex(/^[a-z0-9_]+$/, 'snake_case only'),
  kind: z.enum(CUSTOM_FIELD_KINDS),
  configJson: z
    .object({
      // optional UI/behavioral hints
      label: z.string().max(200).optional(),
      description: z.string().max(2000).optional(),
      options: z.array(z.union([z.string(), z.number()])).optional(),
      optionsUrl: z.string().url().optional(),
      multi: z.boolean().optional(),
      editor: z.string().optional(),
      input: z.string().optional(),
      filterable: z.boolean().optional(),
      formEditable: z.boolean().optional(),
      listVisible: z.boolean().optional(),
      priority: z.number().optional(),
      relatedEntityId: z.string().optional(),
      // validation rules
      validation: validationRulesArraySchema.optional(),
    })
    .passthrough()
    .optional(),
  isActive: z.boolean().optional(),
})

export type UpsertCustomEntityInput = z.infer<typeof upsertCustomEntitySchema>
export type UpsertCustomFieldDefInput = z.infer<typeof upsertCustomFieldDefSchema>
