import { z } from 'zod'
import { blockActionSchema, blockBasePropsSchema, callbackSchema, hasUniqueKeys, iconNameSchema, slotSchema } from './shared'

export const sectionVariantSchema = z.enum(['card', 'plain'])
export type SectionVariant = z.infer<typeof sectionVariantSchema>

export const sectionToneSchema = z.enum(['neutral', 'error'])
export type SectionTone = z.infer<typeof sectionToneSchema>

export const sectionPaddingSchema = z.enum(['default', 'none'])
export type SectionPadding = z.infer<typeof sectionPaddingSchema>

export const sectionLayoutSchema = z.enum(['stacked', 'split'])
export type SectionLayout = z.infer<typeof sectionLayoutSchema>

export const sectionHeadingLevelSchema = z.union([z.literal(2), z.literal(3), z.literal(4)])
export type SectionHeadingLevel = z.infer<typeof sectionHeadingLevelSchema>

export const sectionPropsSchema = blockBasePropsSchema
  .extend({
    title: z.string().min(1),
    description: z.string().min(1).optional(),
    icon: iconNameSchema.optional(),
    count: z.number().int().nonnegative().optional(),
    headingLevel: sectionHeadingLevelSchema.optional(),
    actions: z.array(blockActionSchema).optional(),
    maxVisibleActions: z.number().int().nonnegative().optional(),
    onAction: callbackSchema<(actionKey: string) => void | Promise<void>>().optional(),
    variant: sectionVariantSchema.optional(),
    tone: sectionToneSchema.optional(),
    padding: sectionPaddingSchema.optional(),
    layout: sectionLayoutSchema.optional(),
    divider: z.boolean().optional(),
    collapsible: z.boolean().optional(),
    defaultCollapsed: z.boolean().optional(),
    collapsed: z.boolean().optional(),
    onCollapsedChange: callbackSchema<(collapsed: boolean) => void>().optional(),
    summary: z.string().min(1).optional(),
    children: slotSchema.optional(),
    footer: slotSchema.optional(),
    footerNote: z.string().min(1).optional(),
    emptyTitle: z.string().min(1).optional(),
    emptyDescription: z.string().min(1).optional(),
    headerTrailing: slotSchema.optional(),
  })
  .refine((props) => hasUniqueKeys(props.actions), { message: 'Action keys must be unique', path: ['actions'] })
  .refine((props) => !props.actions?.length || props.onAction !== undefined, {
    message: 'actions require onAction',
    path: ['onAction'],
  })
  .refine(
    (props) =>
      props.collapsible === true ||
      (props.collapsed === undefined &&
        props.defaultCollapsed === undefined &&
        props.onCollapsedChange === undefined &&
        props.summary === undefined),
    {
      message: 'collapsed, defaultCollapsed, onCollapsedChange and summary require collapsible: true',
      path: ['collapsible'],
    },
  )
  .refine((props) => props.collapsed === undefined || props.onCollapsedChange !== undefined, {
    message: 'a controlled collapsed value requires onCollapsedChange',
    path: ['onCollapsedChange'],
  })
export type SectionProps = z.infer<typeof sectionPropsSchema>
