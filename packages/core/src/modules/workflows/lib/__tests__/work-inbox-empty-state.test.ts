/**
 * Why the Work Inbox is empty — the PURE resolver.
 *
 * §6.4 shipped default-ON and turned a full list into a blank one for anybody
 * who is neither an assignee nor in a role queue. These tests pin the two things
 * that make the explanation trustworthy: which case wins when several are true,
 * and what each case is allowed to say.
 */

import {
  WORK_INBOX_NARROWING_FILTER_IDS,
  resolveWorkInboxEmptyState,
  resolveWorkInboxNarrowingFilters,
} from '../work-inbox/empty-state'
import type { WorkInboxEmptyStateInput } from '../work-inbox/empty-state'

/** The state the page holds on first paint: the default filter, a healthy response. */
function baseInput(overrides: Partial<WorkInboxEmptyStateInput> = {}): WorkInboxEmptyStateInput {
  return {
    filterValues: { myWork: 'true' },
    entityHiddenCount: 0,
    degradedKinds: [],
    ...overrides,
  }
}

describe('resolveWorkInboxEmptyState', () => {
  test('nothing assigned is the common case, and it never blames permissions', () => {
    const state = resolveWorkInboxEmptyState(baseInput())

    expect(state.kind).toBe('no-relationship')
    expect(state).toMatchObject({
      titleKey: 'workflows.workInbox.empty.noRelationship.title',
      descriptionKey: 'workflows.workInbox.empty.noRelationship.description',
    })
  })

  test('the default myWork filter is NOT a narrowing — every employee would otherwise be told they filtered', () => {
    expect(resolveWorkInboxNarrowingFilters({ myWork: 'true' })).toEqual([])
    expect(resolveWorkInboxEmptyState(baseInput({ filterValues: { myWork: 'true' } })).kind).toBe(
      'no-relationship',
    )
    // Clearing it (the "All work" option) is a widening, so it is not one either.
    expect(resolveWorkInboxEmptyState(baseInput({ filterValues: { myWork: '' } })).kind).toBe(
      'no-relationship',
    )
  })

  test.each(WORK_INBOX_NARROWING_FILTER_IDS)(
    'a value in %s answers "you filtered", not "you lack permission"',
    (filterId) => {
      const state = resolveWorkInboxEmptyState(
        baseInput({ filterValues: { myWork: 'true', [filterId]: 'anything' } }),
      )

      expect(state.kind).toBe('filtered')
      expect(state.narrowedFilterIds).toEqual([filterId])
    },
  )

  test('an empty-string filter is not applied', () => {
    expect(
      resolveWorkInboxEmptyState(baseInput({ filterValues: { status: '', kind: '' } })).kind,
    ).toBe('no-relationship')
  })

  test('a non-string filter value is ignored rather than counted', () => {
    expect(resolveWorkInboxNarrowingFilters({ status: 3, overdue: true, kind: null })).toEqual([])
  })

  test('narrowed ids keep filter-bar order regardless of object key order', () => {
    expect(
      resolveWorkInboxNarrowingFilters({ status: 'PENDING', kind: 'user_task', role: 'approver' }),
    ).toEqual(['kind', 'role', 'status'])
  })

  test('the entity gate reports a count and nothing else', () => {
    const state = resolveWorkInboxEmptyState(baseInput({ entityHiddenCount: 3 }))

    expect(state.kind).toBe('entity-hidden')
    expect(state).toMatchObject({
      titleKey: 'workflows.workInbox.empty.entityHidden.title',
      descriptionKey: 'workflows.workInbox.empty.entityHidden.description',
      descriptionVars: { count: 3 },
    })
  })

  test('the entity-gate answer discloses no reason code, entity type, id or binding', () => {
    // The API tells a diagnosable caller WHICH refusal it was and WHICH type
    // blocked them. §6.4 keeps some refusals indistinguishable on purpose, so
    // the empty state must widen nothing: it is handed a count and can say only
    // what a count supports.
    const state = resolveWorkInboxEmptyState(
      baseInput({ entityHiddenCount: 2, filterValues: { myWork: 'true' } }),
    )

    const serialized = JSON.stringify(state)
    expect(serialized).not.toContain('denied:')
    expect(serialized).not.toContain('entity-access')
    expect(serialized).not.toContain('unknown-entity-type')
    expect(serialized).not.toContain('customers')
    expect(state.kind === 'filtered' ? {} : state.descriptionVars).toEqual({ count: 2 })
    expect(Object.keys(state).sort()).toEqual([
      'descriptionKey',
      'descriptionVars',
      'kind',
      'narrowedFilterIds',
      'titleKey',
    ])
  })

  test('the entity gate outranks a narrowing — the hidden rows matched the filters', () => {
    const state = resolveWorkInboxEmptyState(
      baseInput({ entityHiddenCount: 1, filterValues: { myWork: 'true', status: 'PENDING' } }),
    )

    expect(state.kind).toBe('entity-hidden')
    // The narrowing is still reported, so a caller is never told the filters
    // are irrelevant — only that they are not the whole story.
    expect(state.narrowedFilterIds).toEqual(['status'])
  })

  test('a degraded source outranks everything — nothing else can claim completeness', () => {
    const state = resolveWorkInboxEmptyState(
      baseInput({
        degradedKinds: ['agent_disposition'],
        entityHiddenCount: 5,
        filterValues: { myWork: 'true', kind: 'user_task' },
      }),
    )

    expect(state.kind).toBe('degraded')
    expect(state).toMatchObject({
      titleKey: 'workflows.workInbox.empty.degraded.title',
      descriptionKey: 'workflows.workInbox.empty.degraded.description',
    })
  })

  test('the degraded answer never names which source failed', () => {
    const state = resolveWorkInboxEmptyState(baseInput({ degradedKinds: ['agent_disposition'] }))

    expect(JSON.stringify(state)).not.toContain('agent_disposition')
  })

  test('the filtered case carries no copy of its own — FilteredEmptyResults owns it', () => {
    const state = resolveWorkInboxEmptyState(baseInput({ filterValues: { status: 'COMPLETED' } }))

    expect(state).toEqual({ kind: 'filtered', narrowedFilterIds: ['status'] })
  })

  test('is pure — the same input answers the same way and the input is not mutated', () => {
    const filterValues = { myWork: 'true', status: 'PENDING' }
    const input = baseInput({ filterValues, entityHiddenCount: 1 })

    expect(resolveWorkInboxEmptyState(input)).toEqual(resolveWorkInboxEmptyState(input))
    expect(filterValues).toEqual({ myWork: 'true', status: 'PENDING' })
  })
})
