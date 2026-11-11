import { z } from 'zod'
import { WAIT_STEP_TYPE } from '../lib/engine/chain-planner.js'
import type { StepHandler } from '../lib/engine/registry.js'
import type { StepDeps } from './deps.js'

/**
 * Wait is a step the PLANNER understands, not one the executor runs — `planSteps` turns it
 * into a pause and parks the run. The handler exists only so the palette can offer it and the
 * inspector can validate its minutes.
 *
 * `execute` is therefore unreachable in normal operation. It is a no-op rather than a throw so
 * that a run which somehow reaches it (a hand-edited definition, a future planner change)
 * continues instead of dead-lettering a customer's journey.
 */
export const waitStep: StepHandler<StepDeps> = {
  type: WAIT_STEP_TYPE,
  labelKey: 'marketing_automation.step.wait.label',
  descriptionKey: 'marketing_automation.step.wait.description',
  icon: 'clock',
  paramsSchema: z.object({ minutes: z.number().int().positive() }),
  uiFields: [
    { name: 'minutes', kind: 'number', labelKey: 'marketing_automation.step.wait.param.minutes', required: true },
  ],
  async execute() {
    return { status: 'skipped', detail: 'wait is handled by the planner' }
  },
}
