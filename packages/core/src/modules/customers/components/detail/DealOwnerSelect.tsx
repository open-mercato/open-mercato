"use client"

import * as React from 'react'
import { LookupSelect, type LookupSelectItem } from '@open-mercato/ui/backend/inputs/LookupSelect'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { useCurrentOrganization } from '@open-mercato/ui/backend/BackendChromeProvider'
import { fetchAssignableStaffMembers } from '../../lib/assignableStaff'

const logger = createLogger('customers')

const ROSTER_PAGE_SIZE = 20

export type DealOwnerOption = {
  id: string
  name?: string | null
  email?: string | null
}

export type DealOwnerSelectProps = {
  value: string | null
  onChange: (next: string | null) => void
  /** Aborts an in-flight roster fetch, matching the other assignable-staff callers. */
  signal?: AbortSignal
  /**
   * The already-known owner, so the picker shows a name immediately instead of waiting for
   * the roster — and keeps showing one when that owner falls outside the fetched page or has
   * since left the assignable roster.
   */
  initialOption?: DealOwnerOption | null
  disabled?: boolean
}

function toLookupItem(id: string, name?: string | null, email?: string | null): LookupSelectItem {
  const trimmedName = typeof name === 'string' ? name.trim() : ''
  const trimmedEmail = typeof email === 'string' ? email.trim() : ''
  // Callers fall back to the e-mail when a user has no name (the deal detail route sends
  // `name: owner.name ?? owner.email`), so without this guard the card showed the same address
  // as both title and subtitle — "admin@acme.com / admin@acme.com" (#6857).
  const hasDistinctName = Boolean(trimmedName) && trimmedName !== trimmedEmail
  return {
    id,
    title: trimmedName || trimmedEmail || id,
    subtitle: hasDistinctName && trimmedEmail ? trimmedEmail : null,
  }
}

/**
 * Single-owner picker shared by every deal surface that assigns ownership (the detail form,
 * both create forms, and the list's bulk reassign dialog).
 *
 * Clearing is supported (spec D5): `LookupSelect`'s clear control emits `null`, which the
 * single-record forms send as `ownerUserId: null` to return a deal to the unowned state the
 * API has always accepted. The bulk dialog treats a null as "no target chosen" and keeps its
 * confirm disabled, so a bulk unassignment still cannot be sent.
 */
export function DealOwnerSelect({
  value,
  onChange,
  initialOption,
  disabled = false,
  signal,
}: DealOwnerSelectProps): React.ReactElement {
  const t = useT()
  // Scopes the roster to the active organization. Without it the staff-module-absent
  // fallback omits `scopeToActiveOrganization`, which lists users across every
  // organization — every other deal-owner picker passes this.
  const activeOrgId = useCurrentOrganization()?.id ?? null

  // The roster is the authority on a user's display name. Once it has resolved the selected
  // value we keep that entry, so the picker stops falling back to `initialOption` — whose label
  // may be a placeholder ("Current user") or an e-mail standing in for a missing name (#6857).
  const resolvedForValue = React.useRef<LookupSelectItem | null>(null)
  // The last roster we actually received, kept in state rather than a ref because it is also
  // handed back to `LookupSelect` as `options`.
  //
  // `LookupSelect` resets its list to `options` whenever it is not searching, and it does not
  // refetch on a plain re-render. After saving the deal the form re-rendered, that reset ran,
  // and `options` held only the single seeded owner — so the field collapsed to one card and
  // stayed that way until reload, with no network request in sight (#6857).
  const [lastRoster, setLastRoster] = React.useState<LookupSelectItem[]>([])
  const lastRosterRef = React.useRef<LookupSelectItem[]>([])

  const seededOptions = React.useMemo<LookupSelectItem[]>(
    () => (initialOption?.id ? [toLookupItem(initialOption.id, initialOption.name, initialOption.email)] : []),
    [initialOption?.email, initialOption?.id, initialOption?.name],
  )

  // What `LookupSelect` falls back to when it is not searching: the roster we already know,
  // with the seeded owner kept only if the roster does not contain them.
  const fallbackOptions = React.useMemo<LookupSelectItem[]>(() => {
    const seeded = seededOptions[0]
    if (seeded && !lastRoster.some((item) => item.id === seeded.id)) return [seeded, ...lastRoster]
    return lastRoster.length ? lastRoster : seededOptions
  }, [lastRoster, seededOptions])


  const searchOwners = React.useCallback(async (query: string): Promise<LookupSelectItem[]> => {
    let items: LookupSelectItem[] = []
    let fetchFailed = false
    try {
      // The assignable roster belongs to the optional `staff` module; when it is disabled the
      // helper turns the 404 into an empty page, so this resolves to "no candidates" rather
      // than an error state.
      const members = await fetchAssignableStaffMembers(query, {
        pageSize: ROSTER_PAGE_SIZE,
        activeOrgId,
        ...(signal ? { signal } : {}),
      })
      items = members.map((member) => toLookupItem(member.userId, member.displayName, member.email))
    } catch (error) {
      logger.error('customers.deals.searchOwners failed', { err: error })
      items = []
      fetchFailed = true
    }

    const isUnfiltered = query.trim().length === 0
    if (items.length === 0 && (fetchFailed || isUnfiltered) && lastRosterRef.current.length > 0) {
      // Keep showing what we last knew rather than collapsing to the seed alone.
      items = lastRosterRef.current
    } else if (items.length > 0 && isUnfiltered) {
      lastRosterRef.current = items
      setLastRoster(items)
    }

    const fromRoster = items.find((item) => item.id === value)
    if (fromRoster) resolvedForValue.current = fromRoster

    // `LookupSelect` only falls back to its `options` prop when it is NOT searching. A set
    // `value` makes it search, so the fetch result replaces that seed — which would leave an
    // owner outside the roster (a departed user, or anyone when the `staff` module is off)
    // rendering as no selection at all. Merge the seed back in so the current value always
    // has a matching, named item.
    // Prefer the roster's own entry for the current value over the caller's seed.
    const resolved = resolvedForValue.current
    const seeded = resolved && resolved.id === value ? resolved : seededOptions[0]
    if (seeded && seeded.id === value && !items.some((item) => item.id === seeded.id)) {
      return [seeded, ...items]
    }
    return items
  }, [activeOrgId, seededOptions, signal, value])

  return (
    <LookupSelect
      value={value}
      onChange={onChange}
      fetchItems={searchOwners}
      options={fallbackOptions}
      disabled={disabled}
      placeholder={translateWithFallback(
        t,
        'customers.deals.owner.searchPlaceholder',
        'Search by name or email…',
      )}
      emptyLabel={translateWithFallback(t, 'customers.deals.owner.empty', 'No staff members found.')}
    />
  )
}

export default DealOwnerSelect
