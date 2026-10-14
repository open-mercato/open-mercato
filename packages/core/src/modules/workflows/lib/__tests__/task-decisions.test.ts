import { describe, test, expect } from '@jest/globals'
import { collectFlowLogicWarnings, collectTaskDecisionWarnings } from '../flow-logic-warnings'
import {
  decisionsToDrafts,
  draftsToDecisions,
  newDecisionDraft,
  type TaskDecisionDraft,
} from '../task-inspector-config'
import { buildApprovalPreset, APPROVAL_PRESET_COMMENT_FIELD } from '../task-presets'
import { userTaskConfigSchema } from '../../data/validators'

/**
 * Step 1.5 — decision buttons bound to durable route ids, plus the approval
 * preset.
 *
 * The binding is the whole point: a decision that stored an INDEX would be
 * silently re-pointed by any route reorder, and one that stored a regenerated
 * id would break on every save. So the assertions here are about ids surviving
 * edits, and about the two ways a binding can genuinely go stale being
 * REPORTED rather than repaired behind the author's back.
 */

function definitionWith(decisions: unknown[], transitions: unknown[]) {
  return {
    steps: [
      {
        stepId: 'approve',
        stepName: 'Approve refund',
        stepType: 'USER_TASK',
        userTaskConfig: { decisions },
      },
      { stepId: 'done', stepName: 'Done', stepType: 'END' },
    ],
    transitions,
  }
}

describe('decision buttons bind to durable route ids', () => {
  test('drafts round-trip a decision without regenerating its id', () => {
    const stored = [
      { id: 'd_approve', label: 'Approve', transitionId: 't_approve', style: 'primary' as const },
      { id: 'd_reject', label: { en: 'Reject' }, transitionId: 't_reject' },
    ]

    const drafts = decisionsToDrafts(stored)
    expect(drafts.map((draft) => draft.id)).toEqual(['d_approve', 'd_reject'])
    expect(drafts[1].label).toBe('Reject')

    // Reordering the buttons must not change which route either one follows.
    const reordered = [drafts[1], drafts[0]]
    expect(draftsToDecisions(reordered)).toEqual([
      { id: 'd_reject', label: { en: 'Reject' }, transitionId: 't_reject' },
      { id: 'd_approve', label: 'Approve', transitionId: 't_approve', style: 'primary' },
    ])
  })

  test('a generated decision id is opaque and unique, never derived from the label', () => {
    const first = newDecisionDraft('t_a')
    const second = newDecisionDraft('t_a')

    expect(first.id).toMatch(/^d_/)
    expect(first.id).not.toBe(second.id)
    expect(first.label).toBe('')
  })

  test('a decision missing its id or its route is not persisted as a broken button', () => {
    const drafts: TaskDecisionDraft[] = [
      { key: 'a', id: '', label: 'Approve', transitionId: 't_a', style: '' },
      { key: 'b', id: 'd_b', label: 'Reject', transitionId: '  ', style: '' },
    ]
    expect(draftsToDecisions(drafts)).toBeUndefined()
  })

  test('a decision with no label falls back to its id rather than rendering blank', () => {
    expect(draftsToDecisions([{ key: 'a', id: 'd_a', label: '  ', transitionId: 't_a', style: '' }])).toEqual([
      { id: 'd_a', label: 'd_a', transitionId: 't_a' },
    ])
  })
})

describe('stale decision bindings surface as Problems warnings', () => {
  test('a decision whose route was deleted warns, and the definition stays saveable', () => {
    const warnings = collectTaskDecisionWarnings(
      definitionWith(
        [{ id: 'd_approve', label: 'Approve', transitionId: 't_gone' }],
        [{ transitionId: 't_approve', fromStepId: 'approve', toStepId: 'done' }],
      ),
    )

    expect(warnings).toEqual([
      {
        code: 'taskDecisionUnknownRoute',
        path: ['steps', 0],
        params: { stepId: 'approve', decisionId: 'd_approve', transitionId: 't_gone' },
      },
    ])
  })

  test('a route that exists but leaves another step is just as unreachable', () => {
    const warnings = collectTaskDecisionWarnings(
      definitionWith(
        [{ id: 'd_approve', label: 'Approve', transitionId: 't_elsewhere' }],
        [{ transitionId: 't_elsewhere', fromStepId: 'done', toStepId: 'approve' }],
      ),
    )

    expect(warnings.map((warning) => warning.code)).toEqual(['taskDecisionUnknownRoute'])
  })

  test('duplicate decision ids warn', () => {
    const warnings = collectTaskDecisionWarnings(
      definitionWith(
        [
          { id: 'd_approve', label: 'Approve', transitionId: 't_approve' },
          { id: 'd_approve', label: 'Approve again', transitionId: 't_approve' },
        ],
        [{ transitionId: 't_approve', fromStepId: 'approve', toStepId: 'done' }],
      ),
    )

    expect(warnings).toEqual([
      {
        code: 'taskDecisionDuplicateId',
        path: ['steps', 0],
        params: { stepId: 'approve', decisionId: 'd_approve' },
      },
    ])
  })

  test('a correctly bound decision warns about nothing', () => {
    const definition = definitionWith(
      [{ id: 'd_approve', label: 'Approve', transitionId: 't_approve' }],
      [{ transitionId: 't_approve', fromStepId: 'approve', toStepId: 'done' }],
    )

    expect(collectTaskDecisionWarnings(definition)).toEqual([])
    expect(collectFlowLogicWarnings(definition).filter((w) => w.code.startsWith('taskDecision'))).toEqual([])
  })

  test('a definition with no decisions at all is unaffected', () => {
    expect(collectTaskDecisionWarnings({ steps: [{ stepId: 'a', stepType: 'USER_TASK' }], transitions: [] })).toEqual([])
    expect(collectTaskDecisionWarnings({})).toEqual([])
  })
})

describe('the approval preset', () => {
  const copy = { approveLabel: 'Approve', rejectLabel: 'Reject', commentLabel: 'Comment' }

  test('produces Approve/Reject bound to the step routes, a comment field, and a binding prompt', () => {
    const preset = buildApprovalPreset({
      ...copy,
      approveTransitionId: 't_approve',
      rejectTransitionId: 't_reject',
    })

    expect(preset.decisions.map((decision) => [decision.label, decision.transitionId, decision.style])).toEqual([
      ['Approve', 't_approve', 'primary'],
      ['Reject', 't_reject', 'destructive'],
    ])
    expect(preset.formFields).toEqual([
      { name: APPROVAL_PRESET_COMMENT_FIELD, type: 'textarea', label: 'Comment', required: false },
    ])
    expect(preset.promptsForEntityBinding).toBe(true)
    expect(preset.entityBindings).toHaveLength(1)
  })

  test('the config it produces parses', () => {
    const preset = buildApprovalPreset({
      ...copy,
      approveTransitionId: 't_approve',
      rejectTransitionId: 't_reject',
    })

    const parsed = userTaskConfigSchema.parse({
      decisions: draftsToDecisions(preset.decisions),
      formSchema: { fields: preset.formFields },
    })

    expect(parsed.decisions).toHaveLength(2)
    expect(parsed.decisions?.[0]?.transitionId).toBe('t_approve')
    expect(parsed.formSchema).toEqual({ fields: preset.formFields })
  })

  test('applying it twice does not duplicate the buttons or the comment field', () => {
    const first = buildApprovalPreset({ ...copy, approveTransitionId: 't_approve', rejectTransitionId: 't_reject' })
    const second = buildApprovalPreset({
      ...copy,
      approveTransitionId: 't_approve',
      rejectTransitionId: 't_reject',
      decisions: first.decisions,
      formFields: first.formFields,
      entityBindings: first.entityBindings,
    })

    expect(second.decisions).toHaveLength(2)
    expect(second.formFields).toHaveLength(1)
    expect(second.entityBindings).toHaveLength(1)
    expect(second.promptsForEntityBinding).toBe(false)
  })

  test('a missing route leaves the button unbound rather than inventing an id', () => {
    const preset = buildApprovalPreset(copy)

    expect(preset.decisions.map((decision) => decision.transitionId)).toEqual(['', ''])
    expect(draftsToDecisions(preset.decisions)).toBeUndefined()
  })

  test('author copy already written is not overwritten', () => {
    const existing: TaskDecisionDraft = {
      key: 'a',
      id: 'd_existing',
      label: 'Sign it off',
      transitionId: 't_approve',
      style: 'primary',
    }
    const preset = buildApprovalPreset({
      ...copy,
      approveTransitionId: 't_approve',
      rejectTransitionId: 't_reject',
      decisions: [existing],
    })

    expect(preset.decisions[0]).toBe(existing)
    expect(preset.decisions).toHaveLength(2)
    expect(preset.decisions[1].label).toBe('Reject')
  })
})
