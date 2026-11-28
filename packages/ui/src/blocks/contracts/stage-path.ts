import { z } from 'zod'
import {
  DISABLED_REASON_ISSUE,
  blockBasePropsSchema,
  callbackSchema,
  disabledReasonRequiresDisabled,
  hasUniqueIds,
  iconNameSchema,
} from './shared'

export const stagePathStageSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().min(1).optional(),
    icon: iconNameSchema.optional(),
    disabled: z.boolean().optional(),
    disabledReason: z.string().min(1).optional(),
    meta: z.string().min(1).optional(),
  })
  .refine(disabledReasonRequiresDisabled, DISABLED_REASON_ISSUE)
export type StagePathStage = z.infer<typeof stagePathStageSchema>

export const stagePathOutcomeToneSchema = z.enum(['success', 'error', 'neutral'])
export type StagePathOutcomeTone = z.infer<typeof stagePathOutcomeToneSchema>

export const stagePathOutcomeSchema = z.object({
  label: z.string().min(1),
  tone: stagePathOutcomeToneSchema,
  description: z.string().min(1).optional(),
})
export type StagePathOutcome = z.infer<typeof stagePathOutcomeSchema>

export const stagePathOrientationSchema = z.enum(['horizontal', 'vertical'])
export type StagePathOrientation = z.infer<typeof stagePathOrientationSchema>

export const stagePathAppearanceSchema = z.enum(['bar', 'markers'])
export type StagePathAppearance = z.infer<typeof stagePathAppearanceSchema>

export const stagePathSizeSchema = z.enum(['default', 'compact'])
export type StagePathSize = z.infer<typeof stagePathSizeSchema>

export const stagePathOverflowSchema = z.enum(['scroll', 'collapse'])
export type StagePathOverflow = z.infer<typeof stagePathOverflowSchema>

export const stagePathVariantSchema = z.enum(['plain', 'card'])
export type StagePathVariant = z.infer<typeof stagePathVariantSchema>

function isStageId(stages: ReadonlyArray<{ id: string }>, id: string | undefined): boolean {
  return id === undefined || stages.some((stage) => stage.id === id)
}

export const stagePathPropsSchema = blockBasePropsSchema
  .extend({
    stages: z.array(stagePathStageSchema).min(2),
    currentStageId: z.string().min(1),
    completedStageIds: z.array(z.string().min(1)).optional(),
    outcome: stagePathOutcomeSchema.optional(),
    onStageSelect: callbackSchema<(stageId: string) => void | Promise<void>>().optional(),
    pendingStageId: z.string().min(1).optional(),
    readOnly: z.boolean().optional(),
    orientation: stagePathOrientationSchema.optional(),
    appearance: stagePathAppearanceSchema.optional(),
    size: stagePathSizeSchema.optional(),
    overflow: stagePathOverflowSchema.optional(),
    variant: stagePathVariantSchema.optional(),
    ariaLabel: z.string().min(1).optional(),
  })
  .refine((props) => hasUniqueIds(props.stages), { message: 'Stage ids must be unique', path: ['stages'] })
  .refine((props) => isStageId(props.stages, props.currentStageId), {
    message: 'currentStageId must match a stage id',
    path: ['currentStageId'],
  })
  .refine((props) => (props.completedStageIds ?? []).every((id) => isStageId(props.stages, id)), {
    message: 'completedStageIds must match stage ids',
    path: ['completedStageIds'],
  })
  .refine((props) => isStageId(props.stages, props.pendingStageId), {
    message: 'pendingStageId must match a stage id',
    path: ['pendingStageId'],
  })
  .refine((props) => !(props.orientation === 'vertical' && props.appearance === 'bar'), {
    message: 'appearance "bar" requires the horizontal orientation',
    path: ['appearance'],
  })
export type StagePathProps = z.infer<typeof stagePathPropsSchema>
