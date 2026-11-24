import { z } from 'zod'
import {
  blockActionSchema,
  blockBasePropsSchema,
  callbackSchema,
  hasUniqueKeys,
  slotSchema,
  toneLabelSchema,
} from './shared'

export const entityHeaderMetaSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  value: z.string(),
})
export type EntityHeaderMeta = z.infer<typeof entityHeaderMetaSchema>

export const entityHeaderPropsSchema = blockBasePropsSchema
  .extend({
    title: z.string().min(1),
    subtitle: z.string().optional(),
    avatar: z.object({ src: z.string().optional(), initials: z.string().min(1).max(3) }).optional(),
    badge: toneLabelSchema.optional(),
    meta: z.array(entityHeaderMetaSchema).optional(),
    actions: z.array(blockActionSchema).optional(),
    primaryActionKey: z.string().min(1).optional(),
    onAction: callbackSchema<(actionKey: string) => void | Promise<void>>().optional(),
    leading: slotSchema.optional(),
    trailing: slotSchema.optional(),
    below: slotSchema.optional(),
  })
  .refine((props) => hasUniqueKeys(props.actions), { message: 'Action keys must be unique', path: ['actions'] })
  .refine((props) => hasUniqueKeys(props.meta), { message: 'Meta keys must be unique', path: ['meta'] })
  .refine((props) => !props.actions?.length || props.onAction !== undefined, {
    message: 'actions require onAction',
    path: ['onAction'],
  })
  .refine(
    (props) =>
      props.primaryActionKey === undefined || (props.actions ?? []).some((action) => action.key === props.primaryActionKey),
    { message: 'primaryActionKey must match an action key', path: ['primaryActionKey'] },
  )
  .refine(
    (props) =>
      props.primaryActionKey === undefined ||
      !(props.actions ?? []).some((action) => action.key === props.primaryActionKey && action.tone === 'destructive'),
    { message: 'primaryActionKey must not reference a destructive action', path: ['primaryActionKey'] },
  )
export type EntityHeaderProps = z.infer<typeof entityHeaderPropsSchema>
