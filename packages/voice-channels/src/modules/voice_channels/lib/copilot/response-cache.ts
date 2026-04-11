import type { SuggestionCard, TranscriptSegment } from '@open-mercato/voice-channels/modules/voice_channels/types'

/**
 * Response cache for demo safety.
 * Maps segment IDs to pre-recorded suggestion cards.
 * When enabled, the orchestrator skips LLM + MCP tool calls
 * and returns cached results instantly.
 */

interface CachedResponse {
  segmentId: number
  suggestions: SuggestionCard[]
}

let cachedResponses: CachedResponse[] = []
let cacheEnabled = false

/** Load cached responses from JSON file */
export function loadResponseCache(responses: CachedResponse[]): void {
  cachedResponses = responses
  cacheEnabled = true
  console.log(`[ResponseCache] Loaded ${responses.length} cached responses`)
}

/** Check if cache has a response for this segment */
export function getCachedResponse(segmentId: number): SuggestionCard[] | null {
  if (!cacheEnabled) return null
  const cached = cachedResponses.find(r => r.segmentId === segmentId)
  return cached?.suggestions ?? null
}

/** Enable/disable cache (toggled via API or env var) */
export function setCacheEnabled(enabled: boolean): void {
  cacheEnabled = enabled
}

export function isCacheEnabled(): boolean {
  return cacheEnabled
}
