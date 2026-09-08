/**
 * Module-root AI tool contribution for the EUDR module.
 *
 * The generator discovers this file and aggregates the read-only compliance
 * pack into the global AI tool registry. The pack exposes scoped EUDR
 * readiness, evidence-gap, product-scope, and country-risk tools only.
 */
import eudrComplianceAiTools from './ai-tools/compliance-pack'
import type { EudrAiToolDefinition } from './ai-tools/types'

export const aiTools: EudrAiToolDefinition[] = [
  ...eudrComplianceAiTools,
]

export default aiTools
