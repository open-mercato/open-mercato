import type { AiToolDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import timeTrackingAiTools from './ai-tools/time-tracking-pack'

/**
 * EP-49. The module's AI tool registry.
 *
 * The generator discovers `ai-tools.ts` at the module root only, so a pack living
 * in `ai-tools/` reaches the runtime through this aggregator — the customers
 * idiom.
 */
export const aiTools: AiToolDefinition[] = [...timeTrackingAiTools]

export default aiTools
