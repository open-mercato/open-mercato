/**
 * Normalizes an OpenCode `message.part.updated` part into a tool-call lifecycle
 * update, shielding callers from OpenCode's wire schema.
 *
 * OpenCode (Go server) streams MCP tool invocations as parts of `type: 'tool'`
 * carrying a `callID`, the `tool` name, and a `state` machine
 * (`state.status: pending|running|completed|error`, `state.input`,
 * `state.output`/`state.error`). The same part id is re-emitted on each state
 * transition, so a tool call surfaces as one or more `progress` updates followed
 * by a single `finish` once the state reaches a terminal status.
 *
 * Older OpenCode builds emitted Anthropic-style `tool_use` / `tool_result`
 * blocks instead; those are still recognized as a fallback so a downgrade does
 * not silently drop traces again.
 *
 * Returns `null` for any part that is not a tool invocation (text, thinking,
 * step markers, …) so callers can ignore it.
 */
export type OpenCodeToolPartUpdate =
  | { phase: 'progress'; callId: string; toolName: string; input?: unknown }
  | {
      phase: 'finish'
      callId: string
      toolName?: string
      input?: unknown
      output?: unknown
      status: 'ok' | 'error'
    }

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

export function normalizeOpenCodeToolPart(rawPart: unknown): OpenCodeToolPartUpdate | null {
  if (!rawPart || typeof rawPart !== 'object') return null
  const part = rawPart as Record<string, unknown>
  const type = asString(part.type)
  if (!type) return null

  // Native OpenCode tool part with a state machine.
  if (type === 'tool') {
    const callId = asString(part.callID) ?? asString(part.id)
    const toolName = asString(part.tool)
    if (!callId || !toolName) return null
    const state = asRecord(part.state)
    const status = asString(state.status)
    const input = 'input' in state ? state.input : undefined
    if (status === 'completed' || status === 'error') {
      const output = status === 'error' ? state.error ?? state.output : state.output
      return {
        phase: 'finish',
        callId,
        toolName,
        input,
        output,
        status: status === 'error' ? 'error' : 'ok',
      }
    }
    return { phase: 'progress', callId, toolName, input }
  }

  // Legacy Anthropic-style parts (older OpenCode builds).
  if (type === 'tool_use') {
    const callId = asString(part.id)
    const toolName = asString(part.name)
    if (!callId || !toolName) return null
    return { phase: 'progress', callId, toolName, input: part.input }
  }
  if (type === 'tool_result') {
    const callId = asString(part.tool_use_id) ?? asString(part.id)
    if (!callId) return null
    return { phase: 'finish', callId, output: part.content, status: 'ok' }
  }

  return null
}
