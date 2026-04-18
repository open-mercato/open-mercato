/**
 * Module-root AI tools contribution for `ai_assistant` (Phase 1 WS-C, Step 3.8).
 *
 * The generator scans every module for a top-level `ai-tools.ts` and takes
 * the `aiTools` (or `default`) export as the module contribution. This file
 * aggregates the three general-purpose tool packs (`search.*`,
 * `attachments.*`, `meta.*`) so they flow through the existing
 * `ai-tools.generated.ts` pipeline without any new generator plumbing.
 */
import type { AiToolDefinition } from './lib/types'
import searchAiTools from './ai-tools/search-pack'
import attachmentsAiTools from './ai-tools/attachments-pack'
import metaAiTools from './ai-tools/meta-pack'

export const aiTools: AiToolDefinition[] = [
  ...searchAiTools,
  ...attachmentsAiTools,
  ...metaAiTools,
]

export default aiTools
