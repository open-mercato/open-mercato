import { mapToolCall, type ToolCallView } from './types'

/**
 * State of the Playground's "Tools used" panel (navigation spec §1, step 1.4).
 * `real` renders the run's actual tool calls fetched from the trace-detail
 * route; `declared` is the honest fallback when that fetch is not available —
 * most notably a 403 for callers holding `agents.run` without `trace.view` —
 * rendering the agent's declared tool list under a "Declared tools" heading
 * instead of the false "Tools used" framing.
 */
export type ToolPanelState =
  | { mode: 'idle' }
  | { mode: 'loading' }
  | { mode: 'real'; calls: ToolCallView[] }
  | { mode: 'declared' }

export function toolPanelStateFromResponse(call: {
  ok: boolean
  status: number
  result?: unknown
}): ToolPanelState {
  if (!call.ok) return { mode: 'declared' }
  const payload = (call.result && typeof call.result === 'object' ? call.result : {}) as Record<
    string,
    unknown
  >
  const rows = Array.isArray(payload.toolCalls) ? payload.toolCalls : []
  const calls = rows
    .map((row) => mapToolCall(row as Record<string, unknown>))
    .filter((row): row is ToolCallView => !!row)
  return { mode: 'real', calls }
}
