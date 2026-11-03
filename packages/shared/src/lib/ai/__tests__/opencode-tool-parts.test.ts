import { normalizeOpenCodeToolPart } from '../opencode-tool-parts'

describe('normalizeOpenCodeToolPart', () => {
  it('opens a native tool part on a non-terminal state', () => {
    const update = normalizeOpenCodeToolPart({
      type: 'tool',
      id: 'prt-1',
      callID: 'call-1',
      tool: 'load_skill',
      state: { status: 'running', input: { skillId: 'x' } },
    })
    expect(update).toEqual({ phase: 'progress', callId: 'call-1', toolName: 'load_skill', input: { skillId: 'x' } })
  })

  it('finishes a native tool part on completed, carrying the output', () => {
    const update = normalizeOpenCodeToolPart({
      type: 'tool',
      callID: 'call-1',
      tool: 'load_skill',
      state: { status: 'completed', input: { skillId: 'x' }, output: { ok: true } },
    })
    expect(update).toEqual({
      phase: 'finish',
      callId: 'call-1',
      toolName: 'load_skill',
      input: { skillId: 'x' },
      output: { ok: true },
      status: 'ok',
    })
  })

  it('maps an errored native tool part to status error, preferring state.error', () => {
    const update = normalizeOpenCodeToolPart({
      type: 'tool',
      callID: 'call-2',
      tool: 'run_skill_script',
      state: { status: 'error', error: 'boom' },
    })
    expect(update).toEqual({
      phase: 'finish',
      callId: 'call-2',
      toolName: 'run_skill_script',
      input: undefined,
      output: 'boom',
      status: 'error',
    })
  })

  it('falls back to part.id when callID is absent', () => {
    const update = normalizeOpenCodeToolPart({
      type: 'tool',
      id: 'prt-9',
      tool: 'search',
      state: { status: 'running' },
    })
    expect(update).toMatchObject({ phase: 'progress', callId: 'prt-9', toolName: 'search' })
  })

  it('handles the legacy tool_use / tool_result shape', () => {
    expect(normalizeOpenCodeToolPart({ type: 'tool_use', id: 'tc-1', name: 'load_skill', input: { a: 1 } })).toEqual({
      phase: 'progress',
      callId: 'tc-1',
      toolName: 'load_skill',
      input: { a: 1 },
    })
    expect(normalizeOpenCodeToolPart({ type: 'tool_result', tool_use_id: 'tc-1', content: { ok: true } })).toEqual({
      phase: 'finish',
      callId: 'tc-1',
      output: { ok: true },
      status: 'ok',
    })
  })

  it('ignores non-tool and malformed parts', () => {
    expect(normalizeOpenCodeToolPart({ type: 'text', text: 'hi' })).toBeNull()
    expect(normalizeOpenCodeToolPart({ type: 'thinking' })).toBeNull()
    expect(normalizeOpenCodeToolPart({ type: 'tool' })).toBeNull() // no callID/tool
    expect(normalizeOpenCodeToolPart(null)).toBeNull()
    expect(normalizeOpenCodeToolPart('nope')).toBeNull()
  })
})
