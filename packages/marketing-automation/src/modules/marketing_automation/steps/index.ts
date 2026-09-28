import type { StepHandler } from '../lib/engine/registry.js'
import type { StepDeps } from './deps.js'
import { addPointsStep } from './add-points.js'
import { addTagStep } from './add-tag.js'
import { sendEmailStep } from './send-email.js'
import { splitStep } from './split.js'
import { waitStep } from './wait.js'

/** Step types this module ships. Other modules add their own through the registry. */
export const builtInSteps: StepHandler<StepDeps>[] = [waitStep, splitStep, addTagStep, addPointsStep, sendEmailStep]

export { addPointsStep, addTagStep, sendEmailStep, splitStep, waitStep }
