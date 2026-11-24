import { z } from 'zod'
import { blockBasePropsSchema, callbackSchema, hasUniqueIds, slotSchema } from './shared'

export const wizardStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  optional: z.boolean().optional(),
  state: z.enum(['complete', 'error', 'upcoming']).optional(),
})
export type WizardStep = z.infer<typeof wizardStepSchema>

export const wizardPropsSchema = blockBasePropsSchema
  .extend({
    steps: z.array(wizardStepSchema).min(1),
    activeStepId: z.string().min(1),
    onNext: callbackSchema<() => Promise<boolean>>(),
    onBack: callbackSchema<() => void>(),
    onStepSelect: callbackSchema<(stepId: string) => void>().optional(),
    onFinish: callbackSchema<() => Promise<void>>(),
    children: slotSchema.optional(),
    footer: slotSchema.optional(),
  })
  .refine((props) => hasUniqueIds(props.steps), { message: 'Step ids must be unique', path: ['steps'] })
  .refine((props) => props.steps.some((step) => step.id === props.activeStepId), {
    message: 'activeStepId must match a step id',
    path: ['activeStepId'],
  })
export type WizardProps = z.infer<typeof wizardPropsSchema>
