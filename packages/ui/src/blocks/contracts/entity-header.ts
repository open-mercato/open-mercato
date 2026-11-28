import { z } from 'zod'
import {
  DISABLED_REASON_ISSUE,
  blockActionFieldsSchema,
  blockBasePropsSchema,
  callbackSchema,
  disabledReasonRequiresDisabled,
  hasUniqueKeys,
  iconNameSchema,
  slotSchema,
  toneLabelSchema,
} from './shared'

export const entityHeaderMetaSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  value: z.string(),
  href: z.string().min(1).optional(),
  suffix: z.string().min(1).optional(),
})
export type EntityHeaderMeta = z.infer<typeof entityHeaderMetaSchema>

export const entityHeaderActionDisplaySchema = z.enum(['label', 'icon'])
export type EntityHeaderActionDisplay = z.infer<typeof entityHeaderActionDisplaySchema>

export const entityHeaderActionSchema = blockActionFieldsSchema
  .extend({ display: entityHeaderActionDisplaySchema.optional() })
  .refine(disabledReasonRequiresDisabled, DISABLED_REASON_ISSUE)
  .refine((action) => action.display !== 'icon' || action.icon !== undefined, {
    message: "display: 'icon' requires an icon",
    path: ['icon'],
  })
export type EntityHeaderAction = z.infer<typeof entityHeaderActionSchema>

export const entityHeaderDestructivePlacementSchema = z.enum(['overflow', 'inline'])
export type EntityHeaderDestructivePlacement = z.infer<typeof entityHeaderDestructivePlacementSchema>

export const entityHeaderAvatarVariantSchema = z.enum(['default', 'monochrome'])
export type EntityHeaderAvatarVariant = z.infer<typeof entityHeaderAvatarVariantSchema>

export const entityHeaderTabSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  icon: iconNameSchema.optional(),
  count: z.number().int().nonnegative().optional(),
  disabled: z.boolean().optional(),
  href: z.string().min(1).optional(),
})
export type EntityHeaderTab = z.infer<typeof entityHeaderTabSchema>

export const entityHeaderPropsSchema = blockBasePropsSchema
  .extend({
    title: z.string().min(1),
    subtitle: z.string().optional(),
    avatar: z
      .object({
        src: z.string().optional(),
        initials: z.string().min(1).max(3),
        variant: entityHeaderAvatarVariantSchema.optional(),
      })
      .optional(),
    badge: toneLabelSchema.optional(),
    badges: z.array(toneLabelSchema).optional(),
    maxVisibleBadges: z.number().int().min(1).optional(),
    meta: z.array(entityHeaderMetaSchema).optional(),
    actions: z.array(entityHeaderActionSchema).optional(),
    destructivePlacement: entityHeaderDestructivePlacementSchema.optional(),
    primaryActionKey: z.string().min(1).optional(),
    onAction: callbackSchema<(actionKey: string) => void | Promise<void>>().optional(),
    leading: slotSchema.optional(),
    trailing: slotSchema.optional(),
    below: slotSchema.optional(),
    count: z.number().int().nonnegative().optional(),
    backLabel: z.string().min(1).optional(),
    backHref: z.string().min(1).optional(),
    onBack: callbackSchema<() => void>().optional(),
    tabs: z.array(entityHeaderTabSchema).min(1).optional(),
    activeTabKey: z.string().min(1).optional(),
    onTabChange: callbackSchema<(tabKey: string) => void>().optional(),
    tabsLabel: z.string().min(1).optional(),
    idBase: z.string().regex(/^[A-Za-z][\w:.-]*$/).optional(),
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
  .refine((props) => hasUniqueKeys(props.tabs), { message: 'Tab keys must be unique', path: ['tabs'] })
  .refine(
    (props) => props.tabs === undefined || props.tabs.some((tab) => tab.key === props.activeTabKey),
    { message: 'tabs require an activeTabKey that matches a tab key', path: ['activeTabKey'] },
  )
  .refine(
    (props) => props.tabs === undefined || props.onTabChange !== undefined || props.tabs.every((tab) => tab.href !== undefined),
    { message: 'tabs require onTabChange unless every tab has an href', path: ['onTabChange'] },
  )
  .refine((props) => props.backLabel === undefined || props.backHref !== undefined || props.onBack !== undefined, {
    message: 'backLabel requires backHref or onBack',
    path: ['backLabel'],
  })
export type EntityHeaderProps = z.infer<typeof entityHeaderPropsSchema>
