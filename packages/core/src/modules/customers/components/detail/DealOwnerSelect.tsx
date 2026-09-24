"use client"

import * as React from 'react'
import { LookupSelect, type LookupSelectItem } from '@open-mercato/ui/backend/inputs/LookupSelect'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { createLogger } from '@open-mercato/shared/lib/logger'
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
  return {
    id,
    title: trimmedName || trimmedEmail || id,
    subtitle: trimmedName && trimmedEmail ? trimmedEmail : null,
  }
}

/**
 * Single-owner picker shared by every deal surface that assigns ownership (the detail form,
 * both create forms, and the list's bulk reassign dialog).
 *
 * `allowClear` is false on purpose: a deal's owner cannot be cleared from the UI, so the
 * control must not be able to emit `onChange(null)`. The API still accepts a null owner;
 * that capability is deliberately not exposed here.
 */
export function DealOwnerSelect({
  value,
  onChange,
  initialOption,
  disabled = false,
}: DealOwnerSelectProps): React.ReactElement {
  const t = useT()

  const seededOptions = React.useMemo<LookupSelectItem[]>(
    () => (initialOption?.id ? [toLookupItem(initialOption.id, initialOption.name, initialOption.email)] : []),
    [initialOption?.email, initialOption?.id, initialOption?.name],
  )

  const searchOwners = React.useCallback(async (query: string): Promise<LookupSelectItem[]> => {
    try {
      // The assignable roster belongs to the optional `staff` module; when it is disabled the
      // helper turns the 404 into an empty page, so this resolves to "no candidates" rather
      // than an error state.
      const members = await fetchAssignableStaffMembers(query, { pageSize: ROSTER_PAGE_SIZE })
      return members.map((member) => toLookupItem(member.userId, member.displayName, member.email))
    } catch (error) {
      logger.error('customers.deals.searchOwners failed', { err: error })
      return []
    }
  }, [])

  return (
    <LookupSelect
      value={value}
      onChange={(next) => {
        // Defensive: allowClear already removes every clear affordance, so a null can only
        // arrive from a future change to the primitive. Dropping it keeps the no-unassignment
        // contract true no matter what the primitive does.
        if (next === null) return
        onChange(next)
      }}
      fetchItems={searchOwners}
      options={seededOptions}
      disabled={disabled}
      allowClear={false}
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
