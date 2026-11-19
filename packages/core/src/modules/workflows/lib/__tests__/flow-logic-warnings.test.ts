/**
 * Step 2.12: the pure Phase 3a author-time checks behind the Problems panel.
 */
import {
  collectConditionFieldPaths,
  collectConditionPathWarnings,
  collectErrorRouteWarnings,
  collectFlowLogicWarnings,
  collectOutcomeRouteWarnings,
} from '../flow-logic-warnings'
import type { ContextLedger } from '../context-ledger'

const ledger = {
  steps: {
    wait: { entries: [{ path: 'order', type: 'object', presence: 'always', source: 'start' }] },
    end: { entries: [{ path: 'order', type: 'object', presence: 'always', source: 'start' }] },
  },
} as unknown as ContextLedger

const eq = (field: string, value: string) => ({ operator: 'AND', rules: [{ field, operator: '==', value }] })

describe('collectConditionFieldPaths', () => {
  it('walks nested groups and skips non-conditions', () => {
    const condition = {
      operator: 'AND',
      rules: [
        { field: 'a', operator: '=', value: 1 },
        { operator: 'OR', rules: [{ field: 'b.c', operator: '>', value: 2 }, null] },
      ],
    }
    expect(collectConditionFieldPaths(condition)).toEqual(['a', 'b.c'])
    expect(collectConditionFieldPaths(null)).toEqual([])
    expect(collectConditionFieldPaths('amount > 5')).toEqual([])
  })
})

describe('collectErrorRouteWarnings', () => {
  it('maps every error-route issue onto its transition index', () => {
    const warnings = collectErrorRouteWarnings({
      steps: [{ stepId: 'a' }, { stepId: 'b' }],
      transitions: [
        { transitionId: 't0', fromStepId: 'a', toStepId: 'b' },
        { transitionId: 't1', fromStepId: 'a', toStepId: 'b', kind: 'error' },
        { transitionId: 't2', fromStepId: 'a', toStepId: 'gone', kind: 'error' },
      ],
    })

    expect(warnings).toEqual([
      { code: 'errorRouteDuplicateTarget', path: ['transitions', 1], params: { transitionId: 't1', stepId: 'a' } },
      { code: 'errorRouteUnknownTarget', path: ['transitions', 2], params: { transitionId: 't2', stepId: 'gone' } },
    ])
  })

  it('says nothing about a definition with no error routes', () => {
    expect(
      collectErrorRouteWarnings({
        steps: [{ stepId: 'a' }, { stepId: 'b' }],
        transitions: [{ transitionId: 't0', fromStepId: 'a', toStepId: 'b' }],
      }),
    ).toEqual([])
  })
})

describe('collectConditionPathWarnings', () => {
  it('flags a WAIT_FOR_CONDITION predicate the ledger cannot resolve', () => {
    const warnings = collectConditionPathWarnings(
      {
        steps: [{ stepId: 'wait', stepType: 'WAIT_FOR_CONDITION', config: { condition: eq('payment.status', 'PAID') } }],
        transitions: [],
      },
      ledger,
    )
    expect(warnings).toEqual([
      { code: 'conditionUnknownPath', path: ['steps', 0, 'config', 'condition'], params: { path: 'payment.status', stepId: 'wait' } },
    ])
  })

  it('resolves a path the ledger provides, including through an object prefix', () => {
    expect(
      collectConditionPathWarnings(
        {
          steps: [{ stepId: 'wait', stepType: 'WAIT_FOR_CONDITION', config: { condition: eq('order.total', '10') } }],
          transitions: [],
        },
        ledger,
      ),
    ).toEqual([])
  })

  it('never flags engine-provided or trigger-payload roots', () => {
    const definition = {
      steps: [
        {
          stepId: 'wait',
          stepType: 'WAIT_FOR_CONDITION',
          config: {
            condition: {
              operator: 'AND',
              rules: [
                { field: 'triggerData.orderId', operator: '=', value: 1 },
                { field: 'workflow.instanceId', operator: '=', value: 1 },
                { field: '__error.stepId', operator: '=', value: 1 },
              ],
            },
          },
        },
      ],
      transitions: [],
    }
    expect(collectConditionPathWarnings(definition, ledger)).toEqual([])
  })

  it('skips a step whose ledger view is unknown rather than guessing', () => {
    expect(
      collectConditionPathWarnings(
        {
          steps: [{ stepId: 'unmapped', stepType: 'WAIT_FOR_CONDITION', config: { condition: eq('x', 'y') } }],
          transitions: [],
        },
        ledger,
      ),
    ).toEqual([])
  })

  it('checks a transition condition against its target step view and de-duplicates', () => {
    const warnings = collectConditionPathWarnings(
      {
        steps: [],
        transitions: [
          {
            transitionId: 't0',
            fromStepId: 'wait',
            toStepId: 'end',
            condition: { operator: 'AND', rules: [{ field: 'gone.path', operator: '=', value: 1 }, { field: 'gone.path', operator: '=', value: 2 }] },
          },
        ],
      },
      ledger,
    )
    expect(warnings).toHaveLength(1)
    expect(warnings[0].params.path).toBe('gone.path')
  })
})

describe('collectFlowLogicWarnings', () => {
  it('combines the error-route, branching and condition checks', () => {
    const definition = {
      steps: [
        { stepId: 'gate', stepType: 'IF_ELSE' },
        { stepId: 'wait', stepType: 'WAIT_FOR_CONDITION', config: { condition: eq('gone', 'X') } },
      ],
      transitions: [
        { transitionId: 't0', fromStepId: 'gate', toStepId: 'wait', condition: eq('status', 'NEW') },
        { transitionId: 't1', fromStepId: 'gate', toStepId: 'missing', kind: 'error' },
      ],
    }

    const codes = collectFlowLogicWarnings(definition, { ledger }).map((warning) => warning.code)
    expect(codes).toContain('errorRouteUnknownTarget')
    expect(codes).toContain('branchingWithoutOtherwise')
    expect(codes).toContain('conditionUnknownPath')
  })

  it('skips the ledger-dependent check when no ledger is supplied', () => {
    const definition = {
      steps: [{ stepId: 'wait', stepType: 'WAIT_FOR_CONDITION', config: { condition: eq('gone', 'X') } }],
      transitions: [],
    }
    expect(collectFlowLogicWarnings(definition)).toEqual([])
  })

  it('warns about config quarantined by a step-type conversion (#4237)', () => {
    const definition = {
      steps: [
        {
          stepId: 'notify',
          stepType: 'AUTOMATED',
          metadata: { unmappedConfig: { assignedTo: 'user_1', config: { duration: 'PT15M' } } },
        },
        { stepId: 'clean', stepType: 'AUTOMATED', metadata: { unmappedConfig: {} } },
      ],
      transitions: [],
    }

    const warnings = collectFlowLogicWarnings(definition)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toEqual({
      code: 'unmappedStepConfig',
      path: ['steps', 0],
      params: { stepId: 'notify', keys: 'assignedTo, config' },
    })
  })

  // Spec 7.2 outcome routes. Both mistakes are invisible on the canvas — the
  // route is drawn and looks wired — so the Problems panel is the only place
  // they can surface.
  it('warns about an outcome route claiming a kind the platform does not define', () => {
    const definition = {
      steps: [{ stepId: 'agent', stepType: 'AUTOMATED' }],
      transitions: [
        {
          transitionId: 't_bogus',
          fromStepId: 'agent',
          toStepId: 'end',
          kind: 'outcome',
          outcomeKind: 'needsReview',
        },
      ],
    }

    expect(collectOutcomeRouteWarnings(definition)).toEqual([
      {
        code: 'outcomeRouteUnknownKind',
        path: ['transitions', 0],
        params: { transitionId: 't_bogus', stepId: 'agent', outcomeKind: 'needsReview' },
      },
    ])
    expect(collectFlowLogicWarnings(definition)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'outcomeRouteUnknownKind' })]),
    )
  })

  it('warns when two routes claim the same outcome on one step', () => {
    const warnings = collectOutcomeRouteWarnings({
      steps: [{ stepId: 'agent', stepType: 'AUTOMATED' }],
      transitions: [
        { transitionId: 't_a', fromStepId: 'agent', toStepId: 'review', kind: 'outcome', outcomeKind: 'rejected' },
        { transitionId: 't_b', fromStepId: 'agent', toStepId: 'halt', kind: 'outcome', outcomeKind: 'rejected' },
      ],
    })
    expect(warnings).toEqual([
      {
        code: 'outcomeRouteDuplicateKind',
        path: ['transitions', 1],
        params: { transitionId: 't_b', stepId: 'agent', outcomeKind: 'rejected' },
      },
    ])
  })

  it('says nothing about a definition that declares no outcome routing', () => {
    expect(
      collectOutcomeRouteWarnings({
        steps: [{ stepId: 'agent', stepType: 'AUTOMATED' }],
        transitions: [{ transitionId: 't_a', fromStepId: 'agent', toStepId: 'end' }],
      }),
    ).toEqual([])
  })

  it('returns nothing for an absent definition', () => {
    expect(collectFlowLogicWarnings(null)).toEqual([])
    expect(collectFlowLogicWarnings(undefined)).toEqual([])
  })
})
