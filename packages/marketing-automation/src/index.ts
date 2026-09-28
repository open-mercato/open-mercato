/**
 * @open-mercato/marketing-automation
 *
 * Marketing automation for Open Mercato: a campaign is a platform event that starts it, an
 * audience expression that decides who it applies to, and an ordered list of steps it runs.
 *
 * The surface kept here is deliberately small. What external code needs is the step registry
 * seam: another module registers a step handler and it appears in the canvas palette with a
 * working inspector form and server-side validation, without touching this package.
 */

export {
  MarketingCampaign,
  MarketingCampaignTrigger,
  MarketingCampaignRun,
  MarketingDispatchDeadLetter,
} from './modules/marketing_automation/data/entities.js'

export type {
  AutomationContext,
  CampaignCanvasLayout,
  CampaignDefinition,
  CampaignStep,
  StepOutcome,
  SubjectDocument,
} from './modules/marketing_automation/lib/engine/types.js'

export { planSteps, WAIT_STEP_TYPE } from './modules/marketing_automation/lib/engine/chain-planner.js'
export type { PlannedStep } from './modules/marketing_automation/lib/engine/chain-planner.js'
export { matchesAudience } from './modules/marketing_automation/lib/engine/audience.js'
