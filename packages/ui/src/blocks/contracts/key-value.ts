import { z } from 'zod'
import { blockBasePropsSchema, callbackSchema, hasUniqueKeys, slotSchema } from './shared'

export const keyValueEditorSchema = z.enum(['text', 'textarea', 'select', 'date'])
export type KeyValueEditor = z.infer<typeof keyValueEditorSchema>

export const keyValueItemSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    value: slotSchema,
    hint: z.string().optional(),
    editable: z.boolean().optional(),
    editor: keyValueEditorSchema.optional(),
    options: z.array(z.object({ value: z.string(), label: z.string().min(1) })).optional(),
  })
  .refine((item) => !item.editable || item.editor !== undefined, {
    message: 'Editable items need an editor',
    path: ['editor'],
  })
  .refine((item) => item.editor !== 'select' || (item.options?.length ?? 0) > 0, {
    message: 'Select editors need options',
    path: ['options'],
  })
export type KeyValueItem = z.infer<typeof keyValueItemSchema>

export const keyValuePropsSchema = blockBasePropsSchema
  .extend({
    items: z.array(keyValueItemSchema),
    columns: z.union([z.literal(1), z.literal(2)]).optional(),
    onEdit: callbackSchema<(key: string, nextValue: string) => Promise<void>>().optional(),
    footer: slotSchema.optional(),
  })
  .refine((props) => hasUniqueKeys(props.items), { message: 'Item keys must be unique', path: ['items'] })
  .refine((props) => !props.items.some((item) => item.editable) || props.onEdit !== undefined, {
    message: 'Editable items require onEdit',
    path: ['onEdit'],
  })
export type KeyValueProps = z.infer<typeof keyValuePropsSchema>
