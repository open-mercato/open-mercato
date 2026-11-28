import type * as React from 'react'
import { z } from 'zod'

export const blockStatusSchema = z.enum(['loading', 'error', 'empty', 'ready'])
export type BlockStatus = z.infer<typeof blockStatusSchema>

export const blockToneSchema = z.enum(['neutral', 'info', 'success', 'warning', 'error'])
export type BlockTone = z.infer<typeof blockToneSchema>

export const iconNameSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
export type BlockIconName = z.infer<typeof iconNameSchema>

export const isoDateTimeSchema = z.iso.datetime({ offset: true })

export const blockActionSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    icon: iconNameSchema.optional(),
    tone: z.enum(['default', 'destructive']).optional(),
    disabled: z.boolean().optional(),
    disabledReason: z.string().min(1).optional(),
  })
  .refine((action) => action.disabledReason === undefined || action.disabled === true, {
    message: 'disabledReason requires disabled: true',
    path: ['disabledReason'],
  })
export type BlockAction = z.infer<typeof blockActionSchema>

export const toneLabelSchema = z.object({
  label: z.string().min(1),
  tone: blockToneSchema,
})
export type BlockToneLabel = z.infer<typeof toneLabelSchema>

export const slotSchema = z.custom<React.ReactNode>(() => true).meta({ kind: 'slot' })

export function callbackSchema<TCallback extends (...args: never[]) => unknown>() {
  return z
    .custom<TCallback>((value) => typeof value === 'function', { message: 'Expected a function' })
    .meta({ kind: 'event' })
}

export const blockBasePropsSchema = z.object({
  status: blockStatusSchema.optional(),
  errorMessage: z.string().optional(),
  emptyState: slotSchema.optional(),
  className: z.string().optional(),
})
export type BlockBaseProps = z.infer<typeof blockBasePropsSchema>

export function hasUniqueKeys(items: ReadonlyArray<{ key: string }> | undefined): boolean {
  if (!items) return true
  return new Set(items.map((item) => item.key)).size === items.length
}

export function hasUniqueIds(items: ReadonlyArray<{ id: string }> | undefined): boolean {
  if (!items) return true
  return new Set(items.map((item) => item.id)).size === items.length
}
