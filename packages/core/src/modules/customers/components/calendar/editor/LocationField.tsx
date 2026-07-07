"use client"

import * as React from 'react'
import { MapPin } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Input } from '@open-mercato/ui/primitives/input'
import { Field } from './inputs'

export function LocationField({
  variant,
  value,
  onChange,
}: {
  variant: 'location' | 'phoneLink'
  value: string
  onChange(next: string): void
}) {
  const t = useT()
  const label = variant === 'phoneLink'
    ? t('customers.calendar.editor.phoneLink', 'Phone / link')
    : t('customers.calendar.editor.location', 'Location')
  const placeholder = variant === 'phoneLink'
    ? t('customers.calendar.editor.phoneLinkPlaceholder', 'Add a phone number or link…')
    : t('customers.calendar.editor.locationPlaceholder', 'Add a location or link…')
  return (
    <Field label={label}>
      <Input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        leftIcon={<MapPin />}
      />
    </Field>
  )
}
