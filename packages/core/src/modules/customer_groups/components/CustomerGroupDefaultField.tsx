"use client"

import * as React from 'react'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type CustomerGroupDefaultFieldProps = {
  value: unknown
  setValue: (value: unknown) => void
  disabled?: boolean
  // Name of the tenant's current default group, excluding the group being edited.
  // `null` when there is no conflict (no other default exists yet).
  conflictGroupName?: string | null
  // True while the tenant's current default group is still being looked up, so the
  // conflict warning cannot be shown yet.
  isLoading?: boolean
}

export function CustomerGroupDefaultField({
  value,
  setValue,
  disabled,
  conflictGroupName,
  isLoading = false,
}: CustomerGroupDefaultFieldProps) {
  const t = useT()
  const checked = value === true

  return (
    <div className="space-y-2">
      <SwitchField
        label={t('customer_groups.groups.form.field.isDefault', 'Default group')}
        description={t(
          'customer_groups.groups.form.field.isDefaultHint',
          'Customers without an explicit group assignment fall back to the tenant default.',
        )}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => setValue(next === true)}
      />
      {checked && isLoading ? <Spinner size="sm" /> : null}
      {checked && !isLoading && conflictGroupName ? (
        <Alert status="warning" size="xs">
          {t(
            'customer_groups.groups.form.field.isDefaultConflict',
            '{name} is currently default — enabling this will replace it',
            { name: conflictGroupName },
          )}
        </Alert>
      ) : null}
    </div>
  )
}
