import { describe, test, expect } from '@jest/globals'
import { interpolateVariables } from '../activity-executor'
import {
  collectResolvedEntityTypes,
  flattenTaskText,
  resolveTaskAssignment,
  resolveTaskDeadlineDuration,
  resolveTaskDecisions,
  resolveTaskEntityBindings,
  resolveTaskText,
} from '../task-resolution'
import { decideTaskVisibility } from '../task-visibility'

/**
 * The pure half of "task creation resolves what authors wrote".
 *
 * These bind the RULES — dynamic assignment falling back to the role queue, a
 * `maybe`-presence binding degrading rather than dangling, localized copy
 * resolving leaf by leaf — against the real Phase-2b interpolator, so a test
 * cannot pass with a stub that behaves differently from the engine.
 */

const runContext = {
  deal: { ownerId: 'user-42' },
  customerId: 'customer-7',
  order: { id: 'order-9', total: 250 },
  blank: '',
}

const interpolate = (value: unknown) => interpolateVariables(value, runContext)

describe('resolveTaskText', () => {
  test('resolves pills in a plain string', () => {
    expect(resolveTaskText('Approve {{context.order.total}} now', interpolate)).toBe('Approve 250 now')
  })

  test('resolves every locale of a localized string', () => {
    expect(
      resolveTaskText({ en: 'Order {{context.order.id}}', pl: 'Zamówienie {{context.order.id}}' }, interpolate)
    ).toEqual({ en: 'Order order-9', pl: 'Zamówienie order-9' })
  })

  test('leaves an unresolvable pill visible instead of blanking the copy', () => {
    expect(resolveTaskText('Ref {{context.missing}}', interpolate)).toBe('Ref {{context.missing}}')
  })

  test('returns null for absent copy', () => {
    expect(resolveTaskText(undefined, interpolate)).toBeNull()
  })
})

describe('flattenTaskText', () => {
  test('prefers the requested locale and falls back to the first declared one', () => {
    expect(flattenTaskText({ en: 'English', pl: 'Polski' }, 'pl')).toBe('Polski')
    expect(flattenTaskText({ pl: 'Polski' }, 'en')).toBe('Polski')
    expect(flattenTaskText('plain')).toBe('plain')
    expect(flattenTaskText(null)).toBeNull()
  })
})

describe('resolveTaskAssignment', () => {
  test('resolves a dynamic assignee from a ledger pill', () => {
    const resolved = resolveTaskAssignment(
      { assignedTo: '{{context.deal.ownerId}}', assignedToRoles: ['approver'] },
      interpolate
    )

    expect(resolved.assignedTo).toBe('user-42')
    expect(resolved.assignedToRoles).toEqual(['approver'])
    expect(resolved.fellBackToRoles).toBe(false)
  })

  test('falls back to the role queue when the path misses', () => {
    const resolved = resolveTaskAssignment(
      { assignedTo: '{{context.deal.missingOwner}}', assignedToRoles: ['approver'] },
      interpolate
    )

    expect(resolved.assignedTo).toBeNull()
    expect(resolved.assignedToRoles).toEqual(['approver'])
    expect(resolved.fellBackToRoles).toBe(true)
  })

  test('falls back when the path resolves to an empty value', () => {
    const resolved = resolveTaskAssignment(
      { assignedTo: '{{context.blank}}', assignedToRoles: ['approver'] },
      interpolate
    )

    expect(resolved.assignedTo).toBeNull()
    expect(resolved.fellBackToRoles).toBe(true)
  })

  test('a static assignee and the legacy array form are untouched', () => {
    expect(resolveTaskAssignment({ assignedTo: 'manager@example.com' }, interpolate)).toEqual({
      assignedTo: 'manager@example.com',
      assignedToRoles: null,
      fellBackToRoles: false,
      assigneeKind: 'user',
      fellBackFromCustomer: false,
    })

    expect(resolveTaskAssignment({ assignedTo: ['approver', 'controller'] }, interpolate)).toEqual({
      assignedTo: null,
      assignedToRoles: ['approver', 'controller'],
      fellBackToRoles: false,
      assigneeKind: 'user',
      fellBackFromCustomer: false,
    })
  })
})

/**
 * `assigneeKind: 'customer'` is the ONLY way a task becomes portal work. Nothing
 * else in the engine writes `user_tasks.assignee_kind = 'customer'`, so without
 * this the entire portal surface would be authorization over an empty set.
 */
describe('resolveTaskAssignment — the portal discriminator', () => {
  test('an authored customer assignee produces a portal task', () => {
    const resolved = resolveTaskAssignment(
      { assignedTo: '{{context.deal.ownerId}}', assigneeKind: 'customer' },
      interpolate
    )

    expect(resolved.assignedTo).toBe('user-42')
    expect(resolved.assigneeKind).toBe('customer')
  })

  test('a role queue is REFUSED alongside a customer assignee', () => {
    // Portal roles are a different namespace and a portal principal cannot claim
    // from a backoffice queue, so offering the row to one would advertise work to
    // an audience that can never reach it (design §7.1).
    const resolved = resolveTaskAssignment(
      { assignedTo: 'portal-user-1', assignedToRoles: ['approver'], assigneeKind: 'customer' },
      interpolate
    )

    expect(resolved.assigneeKind).toBe('customer')
    expect(resolved.assignedToRoles).toBeNull()
  })

  test('an unresolvable customer id falls back to the backoffice, loudly', () => {
    const resolved = resolveTaskAssignment(
      {
        assignedTo: '{{context.deal.missingOwner}}',
        assignedToRoles: ['approver'],
        assigneeKind: 'customer',
      },
      interpolate
    )

    // A customer-addressed task with no assignee is unaddressable: the portal
    // branch has no arm that admits it and portal principals cannot claim.
    expect(resolved.assigneeKind).toBe('user')
    expect(resolved.assignedToRoles).toEqual(['approver'])
    expect(resolved.fellBackFromCustomer).toBe(true)
  })

  test('the legacy array form never becomes a portal task', () => {
    const resolved = resolveTaskAssignment(
      { assignedTo: ['approver'], assigneeKind: 'customer' },
      interpolate
    )

    expect(resolved.assigneeKind).toBe('user')
    expect(resolved.fellBackFromCustomer).toBe(true)
  })

  test('every definition authored before this key existed still means `user`', () => {
    expect(resolveTaskAssignment({ assignedTo: 'user-1' }, interpolate).assigneeKind).toBe('user')
    expect(resolveTaskAssignment({ assignedToRoles: ['approver'] }, interpolate).assigneeKind).toBe(
      'user'
    )
  })
})

describe('resolveTaskEntityBindings', () => {
  test('resolves each idPath against the run context', () => {
    const { bindings, unresolved } = resolveTaskEntityBindings(
      [
        { entityType: 'customers:person', idPath: 'context.customerId', label: 'Customer' },
        { entityType: 'sales:order', idPath: '{{context.order.id}}' },
      ],
      interpolate
    )

    expect(bindings).toEqual([
      { entityType: 'customers:person', entityId: 'customer-7', label: 'Customer' },
      { entityType: 'sales:order', entityId: 'order-9' },
    ])
    expect(unresolved).toEqual([])
  })

  test('drops a binding whose id is absent and names it', () => {
    const { bindings, unresolved } = resolveTaskEntityBindings(
      [
        { entityType: 'customers:person', idPath: 'context.customerId' },
        { entityType: 'sales:invoice', idPath: 'context.invoiceId' },
      ],
      interpolate
    )

    expect(bindings).toEqual([{ entityType: 'customers:person', entityId: 'customer-7' }])
    expect(unresolved).toEqual(['context.invoiceId'])
  })

  test('resolves a localized binding label', () => {
    const { bindings } = resolveTaskEntityBindings(
      [{ entityType: 'sales:order', idPath: 'context.order.id', label: { en: 'Order {{context.order.id}}' } }],
      interpolate
    )

    expect(bindings[0]?.label).toEqual({ en: 'Order order-9' })
  })

  test('no authored bindings resolve to nothing at all', () => {
    expect(resolveTaskEntityBindings(undefined, interpolate)).toEqual({ bindings: [], unresolved: [] })
  })
})

describe('resolveTaskDecisions', () => {
  test('resolves labels and keeps the durable transition binding', () => {
    expect(
      resolveTaskDecisions(
        [
          { id: 'approve', label: 'Approve {{context.order.id}}', transitionId: 't_approve', style: 'primary' },
          { id: 'reject', label: { en: 'Reject' }, transitionId: 'e_legacy_reject' },
        ],
        interpolate
      )
    ).toEqual([
      { id: 'approve', label: 'Approve order-9', transitionId: 't_approve', style: 'primary' },
      { id: 'reject', label: { en: 'Reject' }, transitionId: 'e_legacy_reject' },
    ])
  })

  test('no authored decisions resolve to nothing at all', () => {
    expect(resolveTaskDecisions(undefined, interpolate)).toEqual([])
  })
})

describe('resolveTaskDeadlineDuration', () => {
  test('deadline wins, slaDuration still works, absent stays absent', () => {
    expect(resolveTaskDeadlineDuration({ deadline: { duration: 'PT4H' }, slaDuration: 'P1D' })).toBe('PT4H')
    expect(resolveTaskDeadlineDuration({ slaDuration: 'P1D' })).toBe('P1D')
    expect(resolveTaskDeadlineDuration({})).toBeNull()
  })
})

/**
 * `user_tasks.entity_types` is the denormalization the §6.4 entity gate filters
 * on in SQL. It is derived here so the stored column and the work-inbox
 * projection compute the same set from the same bindings.
 */
describe('collectResolvedEntityTypes', () => {
  test('is verbatim, deduped and order-preserving', () => {
    expect(
      collectResolvedEntityTypes([
        { entityType: 'customers:person', entityId: 'a' },
        { entityType: 'sales:sales_order', entityId: 'b' },
        { entityType: 'customers:person', entityId: 'c' },
      ])
    ).toEqual(['customers:person', 'sales:sales_order'])
  })

  test('does not normalize an authored spelling', () => {
    // Normalizing here would give the SQL filter and the JS predicate two
    // different notions of "the same type"; the predicate keys its access map
    // on exactly the string the binding carries.
    expect(collectResolvedEntityTypes([{ entityType: 'Custmers:Deal', entityId: 'a' }])).toEqual([
      'Custmers:Deal',
    ])
  })

  test('no bindings produce no types — the vacuous-pass case', () => {
    expect(collectResolvedEntityTypes([])).toEqual([])
  })

  test('agrees with the predicate: an empty type set is an empty binding set', () => {
    const bindings = resolveTaskEntityBindings(
      [{ entityType: 'sales:invoice', idPath: 'context.missing' }],
      interpolate
    ).bindings
    expect(bindings).toEqual([])
    expect(collectResolvedEntityTypes(bindings)).toEqual([])
    // Which is what the writer stores as NULL, and NULL is what every
    // pre-Phase-4 row carries — read by the predicate as "no bindings" and
    // passed vacuously for a backoffice principal.
    const decision = decideTaskVisibility(
      {
        kind: 'backoffice',
        userId: 'user-1',
        tenantId: 'tenant-1',
        organizationIds: ['org-1'],
        roleNames: [],
        grantedFeatures: [],
        isSuperAdmin: false,
      },
      {
        id: 'task-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        status: 'PENDING',
        assignedTo: 'user-1',
        assigneeKind: 'user',
        assignedToRoles: null,
        claimedBy: null,
        entityBindings: bindings,
      },
      new Map(),
      { businessContextEnabled: true }
    )
    expect(decision).toEqual({ visible: true, actable: true, claimable: false, reason: 'assignee' })
  })
})
