import type * as React from 'react'
import { z } from 'zod'
import {
  DISABLED_REASON_ISSUE,
  blockActionSchema,
  blockBasePropsSchema,
  callbackSchema,
  disabledReasonRequiresDisabled,
  hasUniqueIds,
  hasUniqueKeys,
  iconNameSchema,
  toneLabelSchema,
} from './shared'

export const recordListLayoutSchema = z.enum(['rows', 'cards'])
export type RecordListLayout = z.infer<typeof recordListLayoutSchema>

export const recordListDensitySchema = z.enum(['default', 'compact'])
export type RecordListDensity = z.infer<typeof recordListDensitySchema>

export const recordListVariantSchema = z.enum(['card', 'plain'])
export type RecordListVariant = z.infer<typeof recordListVariantSchema>

export const recordListItemSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    href: z.string().min(1).optional(),
    icon: iconNameSchema.optional(),
    avatarLabel: z.string().min(1).optional(),
    avatarUrl: z.string().min(1).optional(),
    badge: toneLabelSchema.optional(),
    badges: z.array(toneLabelSchema).optional(),
    subtitle: z.string().min(1).optional(),
    meta: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    trailing: z.string().min(1).optional(),
    actions: z.array(blockActionSchema).optional(),
    disabled: z.boolean().optional(),
  })
  .refine((item) => hasUniqueKeys(item.actions), { message: 'Action keys must be unique', path: ['actions'] })
  .refine((item) => item.icon === undefined || item.avatarLabel === undefined, {
    message: 'Use icon or avatarLabel, not both',
    path: ['avatarLabel'],
  })
  .refine((item) => item.avatarUrl === undefined || item.avatarLabel !== undefined, {
    message: 'avatarUrl requires avatarLabel',
    path: ['avatarLabel'],
  })
  .refine((item) => item.badge === undefined || item.badges === undefined, {
    message: 'Use badge or badges, not both',
    path: ['badges'],
  })
export type RecordListItem = z.infer<typeof recordListItemSchema>

export const recordListSkeletonLeadingSchema = z.enum(['none', 'icon', 'avatar'])
export type RecordListSkeletonLeading = z.infer<typeof recordListSkeletonLeadingSchema>

export const recordListSkeletonSchema = z.object({
  rows: z.number().int().positive().max(12).optional(),
  leading: recordListSkeletonLeadingSchema.optional(),
})
export type RecordListSkeleton = z.infer<typeof recordListSkeletonSchema>

export const recordListAddActionSchema = z
  .object({
    label: z.string().min(1),
    icon: iconNameSchema.optional(),
    href: z.string().min(1).optional(),
    disabled: z.boolean().optional(),
    disabledReason: z.string().min(1).optional(),
  })
  .refine(disabledReasonRequiresDisabled, DISABLED_REASON_ISSUE)
export type RecordListAddAction = z.infer<typeof recordListAddActionSchema>

export const recordListPropsSchema = blockBasePropsSchema
  .extend({
    items: z.array(recordListItemSchema),
    title: z.string().min(1).optional(),
    ariaLabel: z.string().min(1).optional(),
    count: z.number().int().nonnegative().optional(),
    headingLevel: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(),
    addAction: recordListAddActionSchema.optional(),
    onAdd: callbackSchema<() => void>().optional(),
    onItemClick: callbackSchema<(itemId: string) => void>().optional(),
    onItemAction: callbackSchema<(itemId: string, actionKey: string) => void | Promise<void>>().optional(),
    renderItem: callbackSchema<(item: RecordListItem) => React.ReactNode>().optional(),
    layout: recordListLayoutSchema.optional(),
    density: recordListDensitySchema.optional(),
    variant: recordListVariantSchema.optional(),
    maxItems: z.number().int().positive().optional(),
    onShowAll: callbackSchema<() => void>().optional(),
    showAllLabel: z.string().min(1).optional(),
    emptyTitle: z.string().min(1).optional(),
    emptyDescription: z.string().min(1).optional(),
    emptyIcon: iconNameSchema.optional(),
    skeleton: recordListSkeletonSchema.optional(),
  })
  .refine((props) => hasUniqueIds(props.items), { message: 'Item ids must be unique', path: ['items'] })
  .refine((props) => props.title !== undefined || props.ariaLabel !== undefined, {
    message: 'title or ariaLabel is required',
    path: ['ariaLabel'],
  })
  .refine((props) => props.addAction === undefined || props.addAction.href !== undefined || props.onAdd !== undefined, {
    message: 'addAction requires onAdd or href',
    path: ['onAdd'],
  })
  .refine((props) => props.onItemAction !== undefined || props.items.every((item) => !item.actions?.some((action) => !action.href)), {
    message: 'item actions without href require onItemAction',
    path: ['onItemAction'],
  })
export type RecordListProps = z.infer<typeof recordListPropsSchema>
