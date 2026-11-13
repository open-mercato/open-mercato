// Navigation spec §1 step 1.4: the Playground's "Tools used" panel renders the
// run's ACTUAL tool calls, and degrades to the declared-tools framing when the
// trace-detail fetch is unavailable (403 for `agents.run`-without-`trace.view`
// callers, or any other failure).
import { toolPanelStateFromResponse } from '../components/playgroundToolCalls'

describe('toolPanelStateFromResponse', () => {
  it('maps a successful trace-detail response to the real tool-call list', () => {
    const state = toolPanelStateFromResponse({
      ok: true,
      status: 200,
      result: {
        toolCalls: [
          { id: 'tc-1', tool_name: 'policy.lookup', status: 'ok', latency_ms: 280 },
          { id: 'tc-2', toolName: 'deals.read', status: 'error', latencyMs: 120 },
        ],
      },
    })
    expect(state.mode).toBe('real')
    if (state.mode === 'real') {
      expect(state.calls).toHaveLength(2)
      expect(state.calls[0].toolName).toBe('policy.lookup')
      expect(state.calls[0].latencyMs).toBe(280)
      expect(state.calls[1].status).toBe('error')
    }
  })

  it('returns real mode with an empty list when the run made no tool calls', () => {
    const state = toolPanelStateFromResponse({ ok: true, status: 200, result: { toolCalls: [] } })
    expect(state).toEqual({ mode: 'real', calls: [] })
  })

  it('degrades to declared mode on 403 (agents.run without trace.view)', () => {
    expect(toolPanelStateFromResponse({ ok: false, status: 403, result: undefined })).toEqual({
      mode: 'declared',
    })
  })

  it('degrades to declared mode on any other failure', () => {
    expect(toolPanelStateFromResponse({ ok: false, status: 500, result: undefined })).toEqual({
      mode: 'declared',
    })
  })
})
