import { z } from 'zod'
import { SPLIT_STEP_TYPE } from '../lib/engine/split.js'
import type { StepHandler } from '../lib/engine/registry.js'
import type { StepDeps } from './deps.js'

const variantSchema = z.object({
  key: z.string().min(1),
  weight: z.number().positive(),
  steps: z.array(z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    params: z.record(z.string(), z.unknown()).default({}),
  })).default([]),
})

/**
 * A/B split.
 *
 * Like `wait`, this is a step the ENGINE understands structurally rather than one the executor runs:
 * `flattenSteps` resolves it into the lane this subject belongs to before planning, so by the time
 * the executor walks the chain the split is gone. The handler exists so the palette can offer it and
 * the save can validate its lanes.
 *
 * `execute` is therefore unreachable in normal operation, and is a no-op rather than a throw so a
 * hand-edited definition degrades to "no branch" instead of dead-lettering a journey.
 */
export const splitStep: StepHandler<StepDeps> = {
  type: SPLIT_STEP_TYPE,
  labelKey: 'marketing_automation.step.split.label',
  descriptionKey: 'marketing_automation.step.split.description',
  icon: 'split',
  paramsSchema: z.object({ variants: z.array(variantSchema).min(2) }),
  // Edited on the canvas as lanes rather than through generic parameter inputs.
  uiFields: [],
  async execute() {
    return { status: 'skipped', detail: 'split is resolved before execution' }
  },
}
