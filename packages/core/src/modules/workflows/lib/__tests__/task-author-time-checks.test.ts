/**
 * Author-time checks on USER_TASK assignment and bindings (§6.4, design §3.5).
 *
 * §6.4 moved the answer to "who can complete this?" from a feature grant to the
 * definition itself, which means two authoring mistakes that used to be
 * harmless now stall a run:
 *
 * - **A binding whose type resolves to nothing.** The gate refuses what it
 *   cannot normalize, so a typo hides the task from its own assignee, silently,
 *   and no runtime action can repair it — only re-authoring the binding can.
 *   The one ERROR here, and the one finding that blocks a save.
 * - **A task naming nobody.** No assignee and no role queue: the act routes
 *   refuse it with `TASK_NOT_ACTIONABLE`, administration widens seeing without
 *   ever widening acting, and the instance parks there until somebody takes the
 *   row. A WARNING: reassignment is a shipped runtime remedy, the refusal names
 *   it rather than failing silently, and definitions authored before this check
 *   existed must not become unsaveable to an author fixing something unrelated.
 *
 * The third check — a binding the assignee's roles cannot view — is likewise a
 * WARNING: role feature sets are tenant data that change after authoring, and
 * the author is usually not the person who grants features.
 *
 * Every check must also CLEAR: a definition that names an owner and binds a
 * resolvable type raises nothing at all, and no check may fire on a step that is
 * not a USER_TASK.
 */

import { describe, test, expect } from '@jest/globals'
import {
  collectFlowLogicWarnings,
  collectTaskBindingWarnings,
  collectTaskOwnerWarnings,
  type FlowLogicDefinition,
  type TaskAssigneeEntityAccess,
} from '../flow-logic-warnings'

function makeDefinition(steps: unknown[]): FlowLogicDefinition {
  return { steps, transitions: [] } as unknown as FlowLogicDefinition
}

function makeTaskStep(userTaskConfig: Record<string, unknown> | null, stepId = 'approve') {
  return {
    stepId,
    stepType: 'USER_TASK',
    stepName: 'Approve',
    ...(userTaskConfig ? { userTaskConfig } : {}),
  }
}

function codesOf(warnings: ReturnType<typeof collectTaskOwnerWarnings>) {
  return warnings.map((warning) => warning.code)
}

describe('a task nobody owns', () => {
  test('fires as a WARNING when neither an assignee nor a queue is named', () => {
    const warnings = collectTaskOwnerWarnings(makeDefinition([makeTaskStep({ formKey: 'approval' })]))

    expect(warnings).toHaveLength(1)
    expect(warnings[0].code).toBe('taskWithoutOwner')
    // Reassignment is the runtime remedy, so this reports rather than blocks.
    expect(warnings[0].severity).toBe('warning')
    expect(warnings[0].params.stepId).toBe('approve')
    // Mapped onto the step so the Problems panel can select the node.
    expect(warnings[0].path).toEqual(['steps', 0])
  })

  test('clears for an individual assignee, a list of them, or a role queue', () => {
    for (const config of [
      { assignedTo: 'user-1' },
      { assignedTo: ['user-1', 'user-2'] },
      { assignedToRoles: ['approver'] },
      { assignedTo: '', assignedToRoles: ['approver'] },
    ]) {
      expect(collectTaskOwnerWarnings(makeDefinition([makeTaskStep(config)]))).toEqual([])
    }
  })

  test('clears for an assignment rule, which defers the answer to the engine', () => {
    // The rule names a source of truth this file cannot evaluate; treating it as
    // "nobody" would flag every rule-routed task in the repo.
    expect(
      collectTaskOwnerWarnings(makeDefinition([makeTaskStep({ assignmentRule: 'route-by-region' })])),
    ).toEqual([])
  })

  test('blank strings and empty arrays are not owners', () => {
    for (const config of [
      { assignedTo: '   ' },
      { assignedTo: [] },
      { assignedTo: ['  '] },
      { assignedToRoles: [] },
      { assignedToRoles: ['  '] },
      { assignedTo: null, assignedToRoles: null },
    ]) {
      expect(codesOf(collectTaskOwnerWarnings(makeDefinition([makeTaskStep(config)])))).toEqual([
        'taskWithoutOwner',
      ])
    }
  })

  test('never fires on a step that is not a USER_TASK', () => {
    const automated = { stepId: 'notify', stepType: 'AUTOMATED' }
    expect(collectTaskOwnerWarnings(makeDefinition([automated]))).toEqual([])
  })

  test('does not fire on a USER_TASK with no config at all', () => {
    // An unfinished node; the schema speaks to that. This check is about a
    // config that answers "who owns this?" and answers it wrong.
    expect(collectTaskOwnerWarnings(makeDefinition([makeTaskStep(null)]))).toEqual([])
  })
})

describe('a binding whose entity type does not resolve', () => {
  const KNOWN = new Set(['customers:customer_deal', 'sales:sales_order'])

  test('fires as an ERROR against the known-id set', () => {
    const warnings = collectTaskBindingWarnings(
      makeDefinition([
        makeTaskStep({
          assignedTo: 'user-1',
          entityBindings: [{ entityType: 'custmers:deal', idPath: 'context.deal.id' }],
        }),
      ]),
      { knownEntityIds: KNOWN },
    )

    expect(warnings).toHaveLength(1)
    expect(warnings[0].code).toBe('taskBindingUnknownEntityType')
    expect(warnings[0].severity).toBe('error')
    expect(warnings[0].params.entityType).toBe('custmers:deal')
  })

  test('clears for an alias spelling that normalizes onto a known id', () => {
    // `customers:deal` is what the inspector placeholder suggests; the ACL model
    // is keyed on `customers:customer_deal`, and the alias table is the bridge.
    for (const entityType of ['customers:deal', 'Customers.Deal', ' customers:deals ']) {
      expect(
        collectTaskBindingWarnings(
          makeDefinition([
            makeTaskStep({ assignedTo: 'user-1', entityBindings: [{ entityType }] }),
          ]),
          { knownEntityIds: KNOWN },
        ),
      ).toEqual([])
    }
  })

  test('without a known-id set it falls back to a shape test, never to guessing', () => {
    // The browser has no entity registry. Flagging every id it cannot enumerate
    // would make the Problems panel reject correct definitions and block saves,
    // so only a value that is not even SHAPED like an entity id is refused.
    const malformed = collectTaskBindingWarnings(
      makeDefinition([
        makeTaskStep({ assignedTo: 'user-1', entityBindings: [{ entityType: 'Custmers Deal' }] }),
      ]),
    )
    expect(codesOf(malformed)).toEqual(['taskBindingUnknownEntityType'])

    const plausible = collectTaskBindingWarnings(
      makeDefinition([
        makeTaskStep({ assignedTo: 'user-1', entityBindings: [{ entityType: 'my_module:widget' }] }),
      ]),
    )
    expect(plausible).toEqual([])
  })

  test('a task with no bindings raises nothing', () => {
    expect(
      collectTaskBindingWarnings(
        makeDefinition([makeTaskStep({ assignedTo: 'user-1' })]),
        { knownEntityIds: KNOWN },
      ),
    ).toEqual([])
  })
})

describe('a binding the assignee cannot view', () => {
  const access: TaskAssigneeEntityAccess = {
    roleFeatures: {
      approver: ['workflows.tasks.view', 'customers.people.view'],
      manager: ['customers.*'],
    },
    entityViewRequirements: {
      'customers:customer_deal': ['customers.deals.view'],
    },
  }
  const KNOWN = new Set(['customers:customer_deal'])

  test('fires as a WARNING naming the roles that are blind to it', () => {
    const warnings = collectTaskBindingWarnings(
      makeDefinition([
        makeTaskStep({
          assignedToRoles: ['approver'],
          entityBindings: [{ entityType: 'customers:deal' }],
        }),
      ]),
      { knownEntityIds: KNOWN, assigneeEntityAccess: access },
    )

    expect(warnings).toHaveLength(1)
    expect(warnings[0].code).toBe('taskBindingAssigneeCannotView')
    // A warning, not an error: role grants are tenant data that change after
    // authoring, so this must never trap a definition in an unsaveable state.
    expect(warnings[0].severity).toBeUndefined()
    expect(warnings[0].params.roles).toBe('approver')
  })

  test('a wildcard grant clears it', () => {
    // `customers.*` satisfies `customers.deals.view`; an exact string test would
    // flag every real administrator role.
    expect(
      collectTaskBindingWarnings(
        makeDefinition([
          makeTaskStep({
            assignedToRoles: ['manager'],
            entityBindings: [{ entityType: 'customers:deal' }],
          }),
        ]),
        { knownEntityIds: KNOWN, assigneeEntityAccess: access },
      ),
    ).toEqual([])
  })

  test('a role the caller could not describe is not accused', () => {
    // An unknown role means "no data", and no data must never become a finding.
    expect(
      collectTaskBindingWarnings(
        makeDefinition([
          makeTaskStep({
            assignedToRoles: ['auditor'],
            entityBindings: [{ entityType: 'customers:deal' }],
          }),
        ]),
        { knownEntityIds: KNOWN, assigneeEntityAccess: access },
      ),
    ).toEqual([])
  })

  test('the check is inert without the tenant data', () => {
    expect(
      collectTaskBindingWarnings(
        makeDefinition([
          makeTaskStep({
            assignedToRoles: ['approver'],
            entityBindings: [{ entityType: 'customers:deal' }],
          }),
        ]),
        { knownEntityIds: KNOWN },
      ),
    ).toEqual([])
  })
})

describe('the combined set', () => {
  test('a well-formed task raises nothing', () => {
    const definition = makeDefinition([
      makeTaskStep({
        assignedToRoles: ['approver'],
        entityBindings: [{ entityType: 'customers:customer_deal', idPath: 'context.deal.id' }],
      }),
    ])

    expect(collectFlowLogicWarnings(definition)).toEqual([])
  })

  test('both checks surface together through the shared collector, at their own severities', () => {
    const definition = makeDefinition([
      makeTaskStep({ entityBindings: [{ entityType: 'not an entity' }] }),
    ])

    const warnings = collectFlowLogicWarnings(definition)

    expect(codesOf(warnings).sort()).toEqual([
      'taskBindingUnknownEntityType',
      'taskWithoutOwner',
    ])
    expect(
      Object.fromEntries(warnings.map((warning) => [warning.code, warning.severity])),
    ).toEqual({
      taskBindingUnknownEntityType: 'error',
      taskWithoutOwner: 'warning',
    })
  })
})
