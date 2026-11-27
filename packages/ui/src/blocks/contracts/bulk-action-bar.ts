import { z } from 'zod'
import { blockActionSchema, callbackSchema, hasUniqueKeys, slotSchema } from './shared'

const countSchema = z.number().int().min(0)

export const bulkActionBarProgressSchema = z
  .object({
    label: z.string().min(1),
    done: countSchema.optional(),
    total: countSchema.optional(),
  })
  .refine((progress) => progress.done === undefined || progress.total === undefined || progress.done <= progress.total, {
    message: 'done must not exceed total',
    path: ['done'],
  })
export type BulkActionBarProgress = z.infer<typeof bulkActionBarProgressSchema>

export const bulkActionBarPositionSchema = z.enum(['floating', 'inline'])
export type BulkActionBarPosition = z.infer<typeof bulkActionBarPositionSchema>

export const bulkActionBarPropsSchema = z
  .object({
    selectedCount: countSchema,
    totalCount: countSchema.optional(),
    allMatchingSelected: z.boolean().optional(),
    summary: z.string().optional(),
    actions: z.array(blockActionSchema),
    maxVisibleActions: z.number().int().min(1).optional(),
    pendingActionKey: z.string().min(1).optional(),
    progress: bulkActionBarProgressSchema.optional(),
    position: bulkActionBarPositionSchema.optional(),
    clearOnEscape: z.boolean().optional(),
    onAction: callbackSchema<(actionKey: string) => void | Promise<void>>(),
    onClear: callbackSchema<() => void>(),
    onSelectAllMatching: callbackSchema<() => void>().optional(),
    trailing: slotSchema.optional(),
    className: z.string().optional(),
  })
  .refine((props) => hasUniqueKeys(props.actions), { message: 'Action keys must be unique', path: ['actions'] })
  .refine(
    (props) => props.pendingActionKey === undefined || props.actions.some((action) => action.key === props.pendingActionKey),
    { message: 'pendingActionKey must match an action key', path: ['pendingActionKey'] },
  )
  .refine(
    (props) =>
      props.totalCount === undefined || props.totalCount <= props.selectedCount || props.onSelectAllMatching !== undefined,
    { message: 'totalCount greater than selectedCount requires onSelectAllMatching', path: ['onSelectAllMatching'] },
  )
export type BulkActionBarProps = z.infer<typeof bulkActionBarPropsSchema>
