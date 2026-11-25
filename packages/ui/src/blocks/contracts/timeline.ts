import type * as React from 'react'
import { z } from 'zod'
import {
  blockActionSchema,
  blockBasePropsSchema,
  callbackSchema,
  hasUniqueIds,
  hasUniqueKeys,
  iconNameSchema,
  isoDateTimeSchema,
  slotSchema,
  toneLabelSchema,
} from './shared'

export const timelineChangeSchema = z.object({
  key: z.string().min(1).optional(),
  label: z.string().min(1),
  icon: iconNameSchema.optional(),
  from: slotSchema.optional(),
  to: slotSchema,
})
export type TimelineChange = z.infer<typeof timelineChangeSchema>

export const timelineTargetSchema = z.object({
  label: z.string().min(1),
  href: z.string().optional(),
  icon: iconNameSchema.optional(),
  avatarSrc: z.string().optional(),
})
export type TimelineTarget = z.infer<typeof timelineTargetSchema>

export const timelineItemSchema = z.object({
  id: z.string().min(1),
  occurredAt: isoDateTimeSchema,
  kind: z.string().min(1),
  icon: iconNameSchema.optional(),
  title: z.string().min(1),
  body: slotSchema.optional(),
  author: z.object({ name: z.string().min(1), avatarSrc: z.string().optional() }).optional(),
  attachments: z
    .array(z.object({ name: z.string().min(1), href: z.string().optional(), format: z.string().optional() }))
    .optional(),
  status: toneLabelSchema.optional(),
  changes: z.array(timelineChangeSchema).optional(),
  target: timelineTargetSchema.optional(),
  actions: z.array(blockActionSchema).optional(),
})
export type TimelineItem = z.infer<typeof timelineItemSchema>

export const timelineFilterSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  count: z.number().int().nonnegative().optional(),
})
export type TimelineFilter = z.infer<typeof timelineFilterSchema>

export const timelinePropsSchema = blockBasePropsSchema
  .extend({
    items: z.array(timelineItemSchema),
    groupBy: z.enum(['day', 'period', 'none']).optional(),
    order: z.enum(['desc', 'asc']),
    filters: z.array(timelineFilterSchema).optional(),
    activeFilterKey: z.string().min(1).optional(),
    hasMore: z.boolean().optional(),
    onItemAction: callbackSchema<(itemId: string, actionKey: string) => void | Promise<void>>().optional(),
    onFilterChange: callbackSchema<(filterKey: string) => void>().optional(),
    onLoadMore: callbackSchema<() => Promise<void>>().optional(),
    renderItemBody: callbackSchema<(item: TimelineItem) => React.ReactNode>().optional(),
    header: slotSchema.optional(),
  })
  .refine((props) => hasUniqueIds(props.items), { message: 'Item ids must be unique', path: ['items'] })
  .refine((props) => hasUniqueKeys(props.filters), { message: 'Filter keys must be unique', path: ['filters'] })
  .refine((props) => !props.hasMore || props.onLoadMore !== undefined, {
    message: 'hasMore requires onLoadMore',
    path: ['onLoadMore'],
  })
  .refine((props) => !props.items.some((entry) => entry.actions?.length) || props.onItemAction !== undefined, {
    message: 'Item actions require onItemAction',
    path: ['onItemAction'],
  })
  .refine((props) => !props.filters?.length || props.onFilterChange !== undefined, {
    message: 'filters require onFilterChange',
    path: ['onFilterChange'],
  })
  .refine(
    (props) =>
      props.activeFilterKey === undefined || (props.filters ?? []).some((filter) => filter.key === props.activeFilterKey),
    { message: 'activeFilterKey must match a filter key', path: ['activeFilterKey'] },
  )
export type TimelineProps = z.infer<typeof timelinePropsSchema>
