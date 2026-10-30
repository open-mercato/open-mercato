/**
 * Prompt-to-draft, the pure half (spec section 9).
 *
 * These are the decisions that must hold with no model, no canvas and no
 * database: what the request carries, what a response is allowed to become,
 * what the resulting undo entry is called, and which failures mean "there is
 * no model here" rather than "the call went wrong".
 */

import {
  AI_CHECKPOINT_LABEL_MAX_LENGTH,
  WORKFLOW_DRAFT_CATALOG_LIMIT,
  buildAiCheckpointLabel,
  buildWorkflowDraftCatalog,
  buildWorkflowDraftPrompt,
  classifyWorkflowDraftFailure,
  interpretWorkflowDraftObject,
  workflowDraftGenerationSchema,
} from '../ai-authoring'

const catalogInput = {
  stepTypes: ['START', 'END', 'USER_TASK'],
  transitionTriggers: ['auto', 'manual'],
  activityTypes: [{ id: 'SEND_EMAIL', configSchema: { type: 'object' } }, { id: 'WAIT' }],
  commands: [{ id: 'customers.deals.update' }],
  functions: [{ name: 'scoreDeal', label: 'Score a deal' }],
  events: [{ id: 'sales.order.created' }],
}

function validParse(value: unknown) {
  return { ok: true as const, definition: value as { steps: unknown[] } }
}

describe('buildWorkflowDraftCatalog', () => {
  test('carries the platform registries verbatim, renaming only to one field vocabulary', () => {
    const catalog = buildWorkflowDraftCatalog(catalogInput)

    expect(catalog.stepTypes).toEqual(['START', 'END', 'USER_TASK'])
    expect(catalog.transitionTriggers).toEqual(['auto', 'manual'])
    expect(catalog.activityTypes).toEqual([
      { id: 'SEND_EMAIL', configSchema: { type: 'object' } },
      { id: 'WAIT' },
    ])
    expect(catalog.commands).toEqual([{ id: 'customers.deals.update' }])
    expect(catalog.functions).toEqual([{ id: 'scoreDeal', description: 'Score a deal' }])
    expect(catalog.events).toEqual(['sales.order.created'])
  })

  test('caps each registry so a large installation cannot spend the context window on a catalog', () => {
    const many = Array.from({ length: WORKFLOW_DRAFT_CATALOG_LIMIT + 25 }, (unused, index) => ({
      id: `command.${index}`,
    }))
    const catalog = buildWorkflowDraftCatalog({ ...catalogInput, commands: many })

    expect(catalog.commands).toHaveLength(WORKFLOW_DRAFT_CATALOG_LIMIT)
    expect(catalog.commands[0].id).toBe('command.0')
  })
})

describe('buildWorkflowDraftPrompt', () => {
  test('carries the author request and the whole catalog, and forbids inventing identifiers', () => {
    const prompt = buildWorkflowDraftPrompt({
      prompt: '  Approve refunds over 500  ',
      catalog: buildWorkflowDraftCatalog(catalogInput),
    })

    expect(prompt).toContain('Approve refunds over 500')
    expect(prompt).toContain('"SEND_EMAIL"')
    expect(prompt).toContain('"customers.deals.update"')
    expect(prompt).toContain('"sales.order.created"')
    expect(prompt).toMatch(/Never invent a step type/)
    // The graph invariants the Studio would otherwise only report as errors.
    expect(prompt).toMatch(/Exactly one START step/)
  })
})

describe('interpretWorkflowDraftObject', () => {
  const generation = {
    summary: 'Routes refunds over 500 through a manager approval.',
    steps: [
      { stepId: 'start', stepName: 'Start', stepType: 'START' },
      { stepId: 'approve', stepName: 'Approve', stepType: 'USER_TASK' },
      { stepId: 'end', stepName: 'End', stepType: 'END' },
    ],
    transitions: [
      { transitionId: 't_1', fromStepId: 'start', toStepId: 'approve', trigger: 'auto' },
      { transitionId: 't_2', fromStepId: 'approve', toStepId: 'end', trigger: 'auto' },
    ],
  }

  test('maps a well-formed response onto the definition the parser accepts', () => {
    const result = interpretWorkflowDraftObject({ raw: generation, parseDefinition: validParse })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary).toBe('Routes refunds over 500 through a manager approval.')
    expect(result.definition.steps).toHaveLength(3)
  })

  test('refuses a response that does not match the generation contract', () => {
    const result = interpretWorkflowDraftObject({
      raw: { summary: 'no steps at all' },
      parseDefinition: validParse,
    })

    expect(result).toMatchObject({ ok: false, reason: 'malformedResponse' })
    if (result.ok) return
    expect(result.messages.join(' ')).toContain('steps')
  })

  test('refuses a well-formed response the definition schema rejects, and applies nothing', () => {
    const result = interpretWorkflowDraftObject({
      raw: generation,
      parseDefinition: () => ({ ok: false as const, messages: ['steps.0.stepType: invalid'] }),
    })

    expect(result).toEqual({
      ok: false,
      reason: 'schemaError',
      messages: ['steps.0.stepType: invalid'],
    })
  })

  test('never forwards identity fields — they are not on the undo stack', () => {
    let seen: Record<string, unknown> | null = null
    interpretWorkflowDraftObject({
      raw: { ...generation, workflowId: 'hijacked', workflowName: 'Hijacked' },
      parseDefinition: (value) => {
        seen = value as Record<string, unknown>
        return validParse(value)
      },
    })

    expect(seen).not.toBeNull()
    expect(Object.keys(seen!)).toEqual(['steps', 'transitions'])
  })

  test('forwards a declared contextSchema, because the panel state IS versioned', () => {
    let seen: Record<string, unknown> | null = null
    interpretWorkflowDraftObject({
      raw: {
        ...generation,
        contextSchema: { input: { fields: [{ name: 'amount', type: 'number' }] } },
      },
      parseDefinition: (value) => {
        seen = value as Record<string, unknown>
        return validParse(value)
      },
    })

    expect(seen!.contextSchema).toEqual({ input: { fields: [{ name: 'amount', type: 'number' }] } })
  })
})

describe('workflowDraftGenerationSchema', () => {
  test('requires a summary an operator can read', () => {
    const parsed = workflowDraftGenerationSchema.safeParse({
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [{ transitionId: 't_1', fromStepId: 'start', toStepId: 'end', trigger: 'auto' }],
    })
    expect(parsed.success).toBe(false)
  })
})

describe('buildAiCheckpointLabel', () => {
  test('names the entry after the prompt so the undo says what it reverts', () => {
    expect(buildAiCheckpointLabel('Approve refunds over 500', { prefix: 'AI draft' })).toBe(
      'AI draft: Approve refunds over 500',
    )
  })

  test('collapses whitespace so a multi-line prompt stays one label', () => {
    expect(buildAiCheckpointLabel('Approve\n  refunds\tover 500', { prefix: 'AI draft' })).toBe(
      'AI draft: Approve refunds over 500',
    )
  })

  test('truncates on a word boundary rather than mid-word', () => {
    const prompt = 'Approve every refund request above five hundred euros by asking a regional manager'
    const label = buildAiCheckpointLabel(prompt, { prefix: 'AI draft' })

    expect(label.length).toBeLessThanOrEqual(AI_CHECKPOINT_LABEL_MAX_LENGTH)
    expect(label.endsWith('…')).toBe(true)

    // The kept text is a prefix of the prompt that stops where a word does:
    // the very next character in the original is whitespace.
    const kept = label.slice('AI draft: '.length, -1)
    expect(prompt.startsWith(kept)).toBe(true)
    expect(prompt.charAt(kept.length)).toBe(' ')
  })

  test('cuts mid-word only when the budget lands inside the first word', () => {
    const label = buildAiCheckpointLabel('Supercalifragilisticexpialidocious', {
      prefix: 'AI',
      maxLength: 14,
    })
    expect(label).toBe('AI: Supercalif…')
  })

  test('falls back to the prefix alone for an empty prompt', () => {
    expect(buildAiCheckpointLabel('   ', { prefix: 'AI draft' })).toBe('AI draft')
  })
})

describe('classifyWorkflowDraftFailure', () => {
  test.each([
    'no_provider_configured',
    'api_key_missing',
    'agent_unknown',
    'agent_features_denied',
    'execution_mode_not_supported',
  ])('reads %s as "the feature is not set up"', (code) => {
    expect(classifyWorkflowDraftFailure(Object.assign(new Error('nope'), { code }))).toBe(
      'unavailable',
    )
  })

  test('reads anything else as a failed call', () => {
    expect(classifyWorkflowDraftFailure(new Error('rate limited'))).toBe('failed')
    expect(classifyWorkflowDraftFailure(Object.assign(new Error('x'), { code: 'overloaded' }))).toBe(
      'failed',
    )
    expect(classifyWorkflowDraftFailure('a string')).toBe('failed')
    expect(classifyWorkflowDraftFailure(null)).toBe('failed')
  })
})
