import insightsExplainAiTools from './ai-tools/explain-pack'
import insightsXrayAiTools from './ai-tools/xray-pack'
import insightsSimulationAiTools from './ai-tools/simulation-pack'
import type { InsightsAiToolDefinition } from './ai-tools/types'

export const aiTools: InsightsAiToolDefinition[] = [
  ...insightsExplainAiTools,
  ...insightsXrayAiTools,
  ...insightsSimulationAiTools,
]

export default aiTools
