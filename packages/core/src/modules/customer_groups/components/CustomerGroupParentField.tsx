"use client"

import * as React from 'react'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@open-mercato/ui/primitives/select'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { wouldExceedRecommendedDepth, type CustomerGroupSummary } from './customerGroupTree'

// Radix `Select.Item` cannot use an empty string as its value, so "no parent" needs a
// sentinel distinct from every possible uuid.
const NONE_VALUE = '__none__'

export type CustomerGroupParentFieldProps = {
  value: unknown
  setValue: (value: unknown) => void
  disabled?: boolean
  groups: CustomerGroupSummary[]
  excludeIds?: ReadonlySet<string>
  isLoading?: boolean
}

export function CustomerGroupParentField({
  value,
  setValue,
  disabled,
  groups,
  excludeIds,
  isLoading,
}: CustomerGroupParentFieldProps) {
  const t = useT()
  const selectedId = typeof value === 'string' && value.length ? value : null

  const options = React.useMemo(() => {
    return groups
      .filter((group) => !excludeIds?.has(group.id))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [groups, excludeIds])

  const showDepthWarning = selectedId ? wouldExceedRecommendedDepth(selectedId, groups) : false

  return (
    <div className="space-y-2">
      <Select
        value={selectedId ?? NONE_VALUE}
        onValueChange={(next) => setValue(next === NONE_VALUE ? null : next)}
        disabled={disabled || isLoading}
      >
        <SelectTrigger>
          <SelectValue placeholder={t('customer_groups.groups.form.field.parentPlaceholder', 'No parent (top level)')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VALUE}>
            {t('customer_groups.groups.form.field.parentNone', 'No parent (top level)')}
          </SelectItem>
          {options.map((group) => (
            <SelectItem key={group.id} value={group.id}>
              {`${group.name} (${group.code})`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {showDepthWarning ? (
        <Alert status="warning" size="xs">
          {t(
            'customer_groups.groups.form.field.parentDepthWarning',
            'This parent is already deeply nested — this group would land at hierarchy depth 5 or deeper.',
          )}
        </Alert>
      ) : null}
    </div>
  )
}
