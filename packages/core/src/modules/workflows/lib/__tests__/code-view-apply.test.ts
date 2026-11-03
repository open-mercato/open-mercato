/**
 * Code view stage 2 — the apply gate and the issue-to-line projection.
 *
 * The safety model this file pins: canvas → code is live, code → canvas is an
 * explicit Apply, and the apply is REFUSED for anything that does not parse,
 * does not match the schema, or whose graph is broken. A canvas holding a graph
 * the engine rejects is worse than no apply — the author has lost the text they
 * typed and now has to repair a canvas by hand.
 */

import {
  describeCodeViewDraft,
  evaluateCodeViewDraft,
  parseErrorLine,
} from '../code-view-apply'
import {
  locateDefinitionJsonEntities,
  locateIssues,
  severityByLine,
} from '../definition-json-locations'

type Definition = { steps: Array<{ stepId: string }>; transitions: unknown[] }

const acceptEverything = {
  parseDefinition: (parsed: unknown) => ({ ok: true as const, definition: parsed as Definition }),
  validateGraph: () => [],
}

const CANVAS = JSON.stringify({ steps: [{ stepId: 'start' }], transitions: [] }, null, 2)

describe('evaluateCodeViewDraft', () => {
  test('unchanged text is not applied', () => {
    const decision = evaluateCodeViewDraft({ draftText: CANVAS, canvasText: CANVAS, ...acceptEverything })
    expect(decision).toEqual({ ok: false, reason: 'unchanged' })
    expect(describeCodeViewDraft(decision).dirty).toBe(false)
  })

  // Spec section 9: an AI-generated draft has no canvas text to compare
  // against — the author asked for the document, so matching the canvas is a
  // coincidence, not a refusal. Every other refusal still applies, which is
  // what lets a generated definition pass the SAME gate a pasted one does.
  test('with no canvasText, identical text is still applied', () => {
    const decision = evaluateCodeViewDraft({ draftText: CANVAS, ...acceptEverything })
    expect(decision).toMatchObject({ ok: true })
  })

  test('with no canvasText, a broken graph is still refused', () => {
    const decision = evaluateCodeViewDraft({
      draftText: CANVAS,
      parseDefinition: (parsed: unknown) => ({ ok: true as const, definition: parsed as Definition }),
      validateGraph: () => ['Workflow must have exactly one START step'],
    })
    expect(decision).toEqual({
      ok: false,
      reason: 'graphError',
      messages: ['Workflow must have exactly one START step'],
    })
  })

  test('malformed JSON is refused and carries a line to mark', () => {
    const decision = evaluateCodeViewDraft({
      draftText: '{\n  "steps": [\n',
      canvasText: CANVAS,
      ...acceptEverything,
    })
    expect(decision.ok).toBe(false)
    if (decision.ok || decision.reason !== 'parseError') throw new Error('[internal] expected a parse error')
    const status = describeCodeViewDraft(decision)
    expect(status.canApply).toBe(false)
    expect(status.blockingMessages).toHaveLength(1)
  })

  test('a mid-edit rename that momentarily empties the document cannot reach the canvas', () => {
    // Deleting the `s` of `"steps"` is the exact keystroke a live-apply design
    // would use to delete every node on the canvas.
    const decision = evaluateCodeViewDraft({
      draftText: JSON.stringify({ step: [{ stepId: 'start' }], transitions: [] }, null, 2),
      canvasText: CANVAS,
      parseDefinition: () => ({ ok: false as const, messages: ['steps: Required'] }),
      validateGraph: () => [],
    })
    expect(decision).toEqual({ ok: false, reason: 'schemaError', messages: ['steps: Required'] })
    expect(describeCodeViewDraft(decision).canApply).toBe(false)
  })

  test('a schema-valid definition with a broken GRAPH is refused, warnings and all', () => {
    const decision = evaluateCodeViewDraft({
      draftText: JSON.stringify({ steps: [{ stepId: 'orphan' }], transitions: [] }, null, 2),
      canvasText: CANVAS,
      parseDefinition: (parsed) => ({ ok: true as const, definition: parsed as Definition }),
      validateGraph: () => ['Workflow must have a START step'],
    })
    expect(decision).toEqual({
      ok: false,
      reason: 'graphError',
      messages: ['Workflow must have a START step'],
    })
  })

  test('graph WARNINGS never block — the caller passes errors only, exactly as Save does', () => {
    const decision = evaluateCodeViewDraft({
      draftText: JSON.stringify({ steps: [{ stepId: 'start' }], transitions: [{}] }, null, 2),
      canvasText: CANVAS,
      ...acceptEverything,
    })
    expect(decision.ok).toBe(true)
    expect(describeCodeViewDraft(decision).canApply).toBe(true)
  })
})

describe('parseErrorLine', () => {
  test('reads an explicit line number', () => {
    expect(parseErrorLine('Unexpected token } in JSON at line 4 column 1', 'a\nb\nc\nd')).toBe(4)
  })

  test('converts a character position into a line', () => {
    const text = 'one\ntwo\nthree'
    expect(parseErrorLine('Unexpected end of JSON input at position 5', text)).toBe(2)
  })

  test('returns null rather than guessing', () => {
    expect(parseErrorLine('Something went wrong', 'a\nb')).toBeNull()
  })
})

describe('locateDefinitionJsonEntities', () => {
  const text = JSON.stringify(
    {
      workflowId: 'demo',
      steps: [
        { stepId: 'start', stepType: 'START' },
        { stepId: 'notify', stepType: 'AUTOMATED', description: 'mentions start and notify' },
      ],
      transitions: [{ transitionId: 't_1', fromStepId: 'start', toStepId: 'notify' }],
    },
    null,
    2,
  )
  const parsed = JSON.parse(text)

  test('maps each step and transition id to its own element range', () => {
    const locations = locateDefinitionJsonEntities(text, parsed)
    expect(locations.steps.size).toBe(2)
    expect(locations.transitions.size).toBe(1)

    const lines = text.split('\n')
    const startRange = locations.steps.get('start')!
    expect(lines[startRange.startLine - 1]).toContain('{')
    expect(lines.slice(startRange.startLine - 1, startRange.endLine).join('\n')).toContain('"stepId": "start"')

    const notifyRange = locations.steps.get('notify')!
    expect(notifyRange.startLine).toBeGreaterThan(startRange.endLine)
  })

  test('a step id mentioned inside another description does not move the marker', () => {
    const locations = locateDefinitionJsonEntities(text, parsed)
    const startRange = locations.steps.get('start')!
    const notifyRange = locations.steps.get('notify')!
    // "start" also appears inside notify's description and inside the
    // transition's fromStepId; the range must still be the step element.
    expect(startRange.endLine).toBeLessThan(notifyRange.startLine)
  })

  test('a transition id is never confused with a step id', () => {
    const locations = locateDefinitionJsonEntities(text, parsed)
    expect(locations.steps.has('t_1')).toBe(false)
    expect(locations.transitions.has('start')).toBe(false)
  })

  test('a step with no id is skipped rather than desynchronising the ones after it', () => {
    const messy = JSON.stringify(
      { steps: [{ stepType: 'START' }, { stepId: 'second' }], transitions: [] },
      null,
      2,
    )
    const locations = locateDefinitionJsonEntities(messy, JSON.parse(messy))
    expect(locations.steps.size).toBe(1)
    const range = locations.steps.get('second')!
    expect(messy.split('\n').slice(range.startLine - 1, range.endLine).join('\n')).toContain('"stepId": "second"')
  })
})

describe('locateIssues / severityByLine', () => {
  const text = JSON.stringify(
    {
      steps: [{ stepId: 'start' }, { stepId: 'notify' }],
      transitions: [{ transitionId: 't_1' }],
    },
    null,
    2,
  )
  const locations = locateDefinitionJsonEntities(text, JSON.parse(text))

  test('projects node and edge issues onto their element lines', () => {
    const located = locateIssues(
      [
        { id: 'i1', severity: 'error', nodeId: 'notify' },
        { id: 'i2', severity: 'warning', edgeId: 't_1' },
      ],
      locations,
    )
    expect(located.map((issue) => issue.issueId)).toEqual(['i1', 'i2'])
    expect(located[0].line).toBe(locations.steps.get('notify')!.startLine)
    expect(located[1].line).toBe(locations.transitions.get('t_1')!.startLine)
  })

  test('an issue naming nothing, or naming something absent, gets no marker instead of a wrong one', () => {
    expect(locateIssues([{ id: 'i1', severity: 'error' }], locations)).toEqual([])
    expect(locateIssues([{ id: 'i2', severity: 'error', nodeId: 'ghost' }], locations)).toEqual([])
  })

  test('a line carrying both severities paints as the error', () => {
    const line = locations.steps.get('start')!.startLine
    const byLine = severityByLine([
      { issueId: 'w', severity: 'warning', line },
      { issueId: 'e', severity: 'error', line },
    ])
    expect(byLine.get(line)).toBe('error')

    const reversed = severityByLine([
      { issueId: 'e', severity: 'error', line },
      { issueId: 'w', severity: 'warning', line },
    ])
    expect(reversed.get(line)).toBe('error')
  })
})
