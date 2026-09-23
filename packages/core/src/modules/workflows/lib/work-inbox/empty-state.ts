/**
 * Why the Work Inbox is empty (PURE).
 *
 * §6.4 shipped default-ON, and it changed what an empty inbox MEANS. Before it,
 * anybody holding `workflows.tasks.view` read the whole organisation's tasks;
 * now `visible = SCOPE ∧ (RELATIONSHIP ∨ ADMINISTRATIVE) ∧ ENTITY`. So an
 * employee who is neither an assignee nor a member of a role queue went from a
 * full list to a blank one with nothing on screen to explain it. This module is
 * the explanation, and it is PURE for the same reason `lib/task-visibility.ts`
 * is: the decision has to be assertable without a page, a container or a query.
 *
 * It DECIDES ONLY. It reads no ACL, re-derives no part of the rule, and never
 * widens what §6.4 discloses — it consumes signal the API already returned
 * (`meta.degradedKinds`, `diagnostics.entityHiddenCount`) plus the caller's own
 * filter state, and answers with a key.
 *
 * Precedence, strongest evidence first:
 *
 * 1. `degraded` — a source threw, so the merged page is missing an unknown
 *    amount of work. Every other verdict would claim a completeness the response
 *    does not have, and "nothing is assigned to you" would be a guess dressed as
 *    a fact.
 * 2. `entity-hidden` — the server REPORTED rows that matched the query and were
 *    then refused by the entity gate. Their existence proves the filters are not
 *    the whole story, which is why this outranks `filtered`.
 * 3. `filtered` — the caller narrowed the query themselves. Telling somebody
 *    their permissions are wrong when they merely picked a status is the failure
 *    mode this whole surface exists to prevent, so a narrowing always answers
 *    before the relationship verdict.
 * 4. `no-relationship` — the common case, and the only one reached by pure
 *    inference from absence.
 *
 * **`myWork` is deliberately NOT a narrowing signal.** It defaults to `'true'`
 * on the page, and its server-side meaning (assigned ∨ claimed ∨ role overlap)
 * is exactly the RELATIONSHIP clause a non-administrative caller is already
 * restricted to — clearing it shows that caller nothing new. Counting it would
 * make EVERY employee's empty inbox answer `filtered`, which is precisely the
 * explanation they must not be given.
 */

/** Filter ids that genuinely narrow the query. `myWork` is excluded — see above. */
export const WORK_INBOX_NARROWING_FILTER_IDS = [
  'kind',
  'module',
  'entityType',
  'role',
  'priority',
  'status',
  'overdue',
] as const

export type WorkInboxNarrowingFilterId = (typeof WORK_INBOX_NARROWING_FILTER_IDS)[number]

export type WorkInboxEmptyStateInput = {
  /** The filter-bar state as the page holds it. */
  filterValues: Readonly<Record<string, unknown>>
  /**
   * `diagnostics.entityHiddenCount` from the work-inbox response. It is present
   * only for a caller the API already deemed diagnosable (a
   * `workflows.tasks.view_all` holder or a superadmin); for everybody else the
   * gate removed those rows in SQL, the field is absent, and this stays `0`.
   */
  entityHiddenCount: number
  /** `meta.degradedKinds` — sources whose provider threw. */
  degradedKinds: readonly string[]
}

/**
 * The copy to render, as keys.
 *
 * A discriminated union rather than four uniform records, because the `filtered`
 * case deliberately carries NO copy of its own: it is rendered through the
 * shared `FilteredEmptyResults` (via `DataTable`'s `filterAwareEmptyState`),
 * which already owns that message and the clear-filters affordance. Minting a
 * second set of keys for it would be a second place for the two to disagree.
 */
export type WorkInboxEmptyState =
  | {
      kind: 'filtered'
      narrowedFilterIds: readonly WorkInboxNarrowingFilterId[]
    }
  | {
      kind: 'degraded' | 'entity-hidden' | 'no-relationship'
      narrowedFilterIds: readonly WorkInboxNarrowingFilterId[]
      titleKey: string
      descriptionKey: string
      /** Interpolation for `descriptionKey`. Never carries a record, id or reason code. */
      descriptionVars: Readonly<Record<string, number>>
    }

export type WorkInboxEmptyStateKind = WorkInboxEmptyState['kind']

/** A filter is applied when it holds a non-empty string, the shape `FilterBar` writes. */
export function resolveWorkInboxNarrowingFilters(
  filterValues: Readonly<Record<string, unknown>>,
): WorkInboxNarrowingFilterId[] {
  return WORK_INBOX_NARROWING_FILTER_IDS.filter((id) => {
    const value = filterValues[id]
    return typeof value === 'string' && value.length > 0
  })
}

/**
 * Answer why the inbox is empty. Consulted only when the page has zero rows.
 *
 * What each verdict is allowed to say is as load-bearing as which one is picked:
 *
 * - `entity-hidden` names a COUNT and nothing else. §6.4 keeps
 *   `denied:entity-access` and `denied:unknown-entity-type` apart in the API so
 *   an author's typo can be told from a policy refusal, and it keeps some
 *   refusals indistinguishable on purpose. The empty state collapses both into
 *   one sentence and names no record, binding, entity type or reason code.
 * - `degraded` names no kind. A source's kind is the id of a module that may not
 *   be one this caller is otherwise told exists.
 */
export function resolveWorkInboxEmptyState(input: WorkInboxEmptyStateInput): WorkInboxEmptyState {
  const narrowedFilterIds = resolveWorkInboxNarrowingFilters(input.filterValues)

  if (input.degradedKinds.length > 0) {
    return {
      kind: 'degraded',
      narrowedFilterIds,
      titleKey: 'workflows.workInbox.empty.degraded.title',
      descriptionKey: 'workflows.workInbox.empty.degraded.description',
      descriptionVars: {},
    }
  }

  if (input.entityHiddenCount > 0) {
    return {
      kind: 'entity-hidden',
      narrowedFilterIds,
      titleKey: 'workflows.workInbox.empty.entityHidden.title',
      descriptionKey: 'workflows.workInbox.empty.entityHidden.description',
      descriptionVars: { count: input.entityHiddenCount },
    }
  }

  if (narrowedFilterIds.length > 0) {
    return { kind: 'filtered', narrowedFilterIds }
  }

  return {
    kind: 'no-relationship',
    narrowedFilterIds,
    titleKey: 'workflows.workInbox.empty.noRelationship.title',
    descriptionKey: 'workflows.workInbox.empty.noRelationship.description',
    descriptionVars: {},
  }
}
