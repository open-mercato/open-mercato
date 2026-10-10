import { defineSimulateConfig } from '@open-mercato/shared/modules/insights/simulate'
import { triggerBacktestKind } from './lib/simulation/trigger-backtest'

/**
 * Change simulator contribution of workflows: the trigger backtest (`workflows.trigger_backtest`)
 * evaluates the event triggers of a proposed workflow definition against recorded events without
 * starting any instance.
 */
export const simulateConfig = defineSimulateConfig({
  version: 1,
  kinds: [triggerBacktestKind],
})

export default simulateConfig
