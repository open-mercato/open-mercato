"use client"

import * as React from 'react'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'

type PickerKind = 'companies' | 'contacts' | 'units'

function pickerMessage(t: TranslateFn, kind: PickerKind, forbidden: boolean): string {
  if (kind === 'companies') {
    return forbidden
      ? t('property_management.leases.form.companiesForbidden', 'You do not have permission to view CRM companies.')
      : t('property_management.leases.form.companiesLoadError', 'Could not load CRM companies.')
  }
  if (kind === 'contacts') {
    return forbidden
      ? t('property_management.leases.form.contactsForbidden', 'You do not have permission to view the company’s people.')
      : t('property_management.leases.form.contactsLoadError', 'Could not load the company’s people.')
  }
  return forbidden
    ? t('property_management.leases.form.unitsForbidden', 'You do not have permission to view the units that can be leased.')
    : t('property_management.leases.form.unitsLoadError', 'Could not load the units that can be leased.')
}

export function PickerLoadError({ status, kind }: { status: number | null; kind: PickerKind }) {
  const t = useT()
  if (status === null) return null
  const message = pickerMessage(t, kind, status === 403)
  return <p className="text-sm text-status-error-text" role="alert" data-testid={`pm-lease-${kind}-error`}>{message}</p>
}
