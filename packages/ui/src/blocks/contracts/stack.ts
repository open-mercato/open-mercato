import { z } from 'zod'
import { slotSchema } from './shared'

export const layoutGapSchema = z.literal([0, 1, 2, 3, 4, 5, 6, 8, 10, 12])
export type LayoutGap = z.infer<typeof layoutGapSchema>

export const stackPropsSchema = z.object({
  gap: layoutGapSchema.optional(),
  align: z.enum(['start', 'center', 'end', 'stretch', 'baseline']).optional(),
  justify: z.enum(['start', 'center', 'end', 'between']).optional(),
  wrap: z.boolean().optional(),
  className: z.string().optional(),
  children: slotSchema.optional(),
})
export type StackProps = z.infer<typeof stackPropsSchema>

export const inlinePropsSchema = stackPropsSchema
export type InlineProps = z.infer<typeof inlinePropsSchema>
