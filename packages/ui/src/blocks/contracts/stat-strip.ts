import { z } from 'zod'
import {
  blockBasePropsSchema,
  blockToneSchema,
  callbackSchema,
  hasUniqueIds,
  iconNameSchema,
  toneLabelSchema,
} from './shared'

export const statDeltaDirectionSchema = z.enum(['up', 'down', 'flat'])
export type StatDeltaDirection = z.infer<typeof statDeltaDirectionSchema>

export const statDeltaSentimentSchema = z.enum(['positive', 'negative', 'neutral'])
export type StatDeltaSentiment = z.infer<typeof statDeltaSentimentSchema>

export const statDeltaSchema = z.object({
  direction: statDeltaDirectionSchema,
  label: z.string().min(1),
  sentiment: statDeltaSentimentSchema.optional(),
})
export type StatDelta = z.infer<typeof statDeltaSchema>

export const statTrendSchema = z.array(z.number().finite()).min(2).max(60)
export type StatTrend = z.infer<typeof statTrendSchema>

export const statItemActionSchema = z.object({
  label: z.string().min(1),
  href: z.string().min(1).optional(),
})
export type StatItemAction = z.infer<typeof statItemActionSchema>

export const statItemSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    value: z.string().min(1),
    caption: z.string().min(1).optional(),
    icon: iconNameSchema.optional(),
    delta: statDeltaSchema.optional(),
    trend: statTrendSchema.optional(),
    badge: toneLabelSchema.optional(),
    tone: blockToneSchema.optional(),
    href: z.string().min(1).optional(),
    interactive: z.boolean().optional(),
    action: statItemActionSchema.optional(),
    disabled: z.boolean().optional(),
  })
  .refine((item) => item.action === undefined || item.href === undefined, {
    message: 'An item with an action cannot also be a link',
    path: ['href'],
  })
  .refine((item) => item.action === undefined || item.interactive !== true, {
    message: 'An item with an action cannot be interactive',
    path: ['interactive'],
  })
  .refine((item) => item.interactive !== false || item.href === undefined, {
    message: 'interactive: false cannot be combined with href',
    path: ['interactive'],
  })
export type StatItem = z.infer<typeof statItemSchema>

export const statStripColumnsSchema = z.union([
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal('auto'),
])
export type StatStripColumns = z.infer<typeof statStripColumnsSchema>

export const statStripVariantSchema = z.enum(['card', 'plain'])
export type StatStripVariant = z.infer<typeof statStripVariantSchema>

export const statStripSizeSchema = z.enum(['default', 'compact'])
export type StatStripSize = z.infer<typeof statStripSizeSchema>

export function isStatItemInteractive(item: StatItem, hasItemClick: boolean): boolean {
  if (item.action !== undefined || item.interactive === false) return false
  return item.href !== undefined || hasItemClick
}

export const statStripPropsSchema = blockBasePropsSchema
  .extend({
    items: z.array(statItemSchema),
    onItemClick: callbackSchema<(itemId: string) => void>().optional(),
    onItemAction: callbackSchema<(itemId: string) => void>().optional(),
    selectedId: z.string().min(1).optional(),
    columns: statStripColumnsSchema.optional(),
    variant: statStripVariantSchema.optional(),
    size: statStripSizeSchema.optional(),
    ariaLabel: z.string().min(1).optional(),
    skeletonCount: z.number().int().min(1).max(12).optional(),
  })
  .refine((props) => hasUniqueIds(props.items), { message: 'Item ids must be unique', path: ['items'] })
  .refine((props) => props.selectedId === undefined || props.items.some((item) => item.id === props.selectedId), {
    message: 'selectedId must match an item id',
    path: ['selectedId'],
  })
  .refine(
    (props) =>
      props.selectedId === undefined ||
      props.items.some(
        (item) => item.id === props.selectedId && isStatItemInteractive(item, props.onItemClick !== undefined),
      ),
    { message: 'selectedId requires an interactive item: onItemClick or an href, and no action', path: ['selectedId'] },
  )
  .refine(
    (props) => props.onItemClick !== undefined || props.items.every((item) => item.interactive !== true || item.href !== undefined),
    { message: 'interactive: true requires onItemClick or an href', path: ['items'] },
  )
  .refine(
    (props) =>
      props.onItemAction !== undefined || props.items.every((item) => item.action === undefined || item.action.href !== undefined),
    { message: 'An action without href requires onItemAction', path: ['onItemAction'] },
  )
export type StatStripProps = z.infer<typeof statStripPropsSchema>
