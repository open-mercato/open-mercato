import { z } from 'zod'
import {
  blockActionSchema,
  blockBasePropsSchema,
  callbackSchema,
  hasUniqueIds,
  hasUniqueKeys,
  iconNameSchema,
  slotSchema,
} from './shared'

export const LIST_TOOLBAR_DEFAULT_DEBOUNCE_MS = 300
export const LIST_TOOLBAR_DEFAULT_MAX_VISIBLE_CHIPS = 6
export const LIST_TOOLBAR_DEFAULT_STICKY_OFFSET = 'var(--topbar-height, 0px)'

export const listToolbarSearchSchema = z.object({
  value: z.string(),
  placeholder: z.string().optional(),
  label: z.string().min(1).optional(),
  debounceMs: z.number().int().min(0).optional(),
})
export type ListToolbarSearch = z.infer<typeof listToolbarSearchSchema>

export const listToolbarQuickFilterSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: iconNameSchema.optional(),
  active: z.boolean(),
  count: z.number().int().min(0).optional(),
  disabled: z.boolean().optional(),
})
export type ListToolbarQuickFilter = z.infer<typeof listToolbarQuickFilterSchema>

export const listToolbarChipSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  removable: z.boolean().optional(),
})
export type ListToolbarChip = z.infer<typeof listToolbarChipSchema>

export const listToolbarViewSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: iconNameSchema.optional(),
  href: z.string().min(1).optional(),
})
export type ListToolbarView = z.infer<typeof listToolbarViewSchema>

export const listToolbarStickySchema = z.enum(['none', 'top'])
export type ListToolbarSticky = z.infer<typeof listToolbarStickySchema>

function collectActions(props: {
  primaryAction?: { key: string }
  secondaryActions?: Array<{ key: string }>
}): Array<{ key: string }> {
  return [...(props.primaryAction ? [props.primaryAction] : []), ...(props.secondaryActions ?? [])]
}

export const listToolbarPropsSchema = blockBasePropsSchema
  .extend({
    ariaLabel: z.string().min(1).optional(),
    search: listToolbarSearchSchema.optional(),
    onSearchChange: callbackSchema<(value: string) => void>().optional(),
    quickFilters: z.array(listToolbarQuickFilterSchema).optional(),
    onQuickFilterToggle: callbackSchema<(id: string, next: boolean) => void>().optional(),
    filtersActiveCount: z.number().int().min(0).optional(),
    onOpenFilters: callbackSchema<(anchor: HTMLElement | null) => void>().optional(),
    chips: z.array(listToolbarChipSchema).optional(),
    onChipOpen: callbackSchema<(id: string, anchor: HTMLElement | null) => void>().optional(),
    onChipRemove: callbackSchema<(id: string) => void>().optional(),
    onAddFilter: callbackSchema<() => void>().optional(),
    onClearAll: callbackSchema<() => void>().optional(),
    maxVisibleChips: z.number().int().min(1).optional(),
    views: z.array(listToolbarViewSchema).optional(),
    activeViewId: z.string().min(1).optional(),
    onViewChange: callbackSchema<(id: string) => void>().optional(),
    primaryAction: blockActionSchema.optional(),
    secondaryActions: z.array(blockActionSchema).optional(),
    onAction: callbackSchema<(actionKey: string) => void | Promise<void>>().optional(),
    resultSummary: z.string().optional(),
    busy: z.boolean().optional(),
    sticky: listToolbarStickySchema.optional(),
    stickyOffset: z.string().min(1).optional(),
    leading: slotSchema.optional(),
    searchTrailing: slotSchema.optional(),
    filterBar: slotSchema.optional(),
    trailing: slotSchema.optional(),
  })
  .refine((props) => props.search === undefined || props.onSearchChange !== undefined, {
    message: 'search requires onSearchChange',
    path: ['onSearchChange'],
  })
  .refine((props) => hasUniqueIds(props.quickFilters), {
    message: 'Quick filter ids must be unique',
    path: ['quickFilters'],
  })
  .refine((props) => hasUniqueIds(props.chips), { message: 'Chip ids must be unique', path: ['chips'] })
  .refine((props) => hasUniqueIds(props.views), { message: 'View ids must be unique', path: ['views'] })
  .refine(
    (props) => props.activeViewId === undefined || (props.views ?? []).some((view) => view.id === props.activeViewId),
    { message: 'activeViewId must match a view id', path: ['activeViewId'] },
  )
  .refine((props) => hasUniqueKeys(collectActions(props)), {
    message: 'Action keys must be unique',
    path: ['secondaryActions'],
  })
  .refine((props) => collectActions(props).length === 0 || props.onAction !== undefined, {
    message: 'actions require onAction',
    path: ['onAction'],
  })
  .refine((props) => props.primaryAction?.tone !== 'destructive', {
    message: 'primaryAction must not be destructive',
    path: ['primaryAction'],
  })
export type ListToolbarProps = z.infer<typeof listToolbarPropsSchema>
