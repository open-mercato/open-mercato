import { defineSimulateConfig } from '@open-mercato/shared/modules/insights/simulate'
import { ruleBacktestKind } from './lib/simulation/rule-backtest'

/**
 * Change simulator contribution of business rules: the rule backtest (`business_rules.rule_backtest`)
 * evaluates a proposed rule definition against recorded events without executing anything.
 */
export const simulateConfig = defineSimulateConfig({
  version: 1,
  kinds: [ruleBacktestKind],
})

export default simulateConfig
