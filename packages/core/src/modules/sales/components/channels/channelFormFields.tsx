"use client"

import * as React from 'react'
import type { CrudCustomFieldRenderProps, CrudField, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useDisplayProfile } from '@open-mercato/ui/backend/markets/MarketProfileProvider'
import { Input } from '@open-mercato/ui/primitives/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { resolveAddressLayout } from '@open-mercato/shared/lib/display/address'
import { findSubdivision } from '@open-mercato/shared/lib/location/subdivisions'
import { LEGACY_DISPLAY_DEFAULTS } from '@open-mercato/shared/lib/display/profile'

export type ChannelFormValues = {
  name: string
  code?: string | null
  description?: string | null
  websiteUrl?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
  statusEntryId?: string | null
  addressLine1?: string | null
  addressLine2?: string | null
  city?: string | null
  region?: string | null
  postalCode?: string | null
  country?: string | null
  latitude?: string | number | null
  longitude?: string | number | null
  isActive?: boolean
} & Record<string, unknown>

/**
 * The channel address is a postal address like any other, so it takes its region and postal-code
 * wording - and the state list for the country it currently holds - from the same descriptor the
 * address editors read. Without a market the labels are the ones this form already showed.
 *
 * `country` is what makes the list follow the address rather than the organization. The label hooks
 * call this without one, because the wording is a market convention and not a property of the
 * country typed into the form.
 */
function useChannelAddressDescriptor(country?: string | null) {
  const profile = useDisplayProfile()
  return React.useMemo(() => resolveAddressLayout(profile, { country }), [country, profile])
}

/**
 * The channel form's region control, as a CrudForm `custom` field.
 *
 * `fields` is memoized once per render of `useChannelFields` and cannot change a field's `type` on a
 * sibling's value, so a `select`-or-`text` branch decided at hook time could never react to the
 * country. A `custom` field receives the live form values and re-renders with them, which is the
 * sanctioned CrudForm mechanism for a field that depends on a sibling.
 */
export function ChannelRegionField({ id, value, error, disabled, values, setValue }: CrudCustomFieldRenderProps) {
  const labels = useChannelFieldLabels()
  const country = typeof values?.country === 'string' ? values.country : null
  const descriptor = useChannelAddressDescriptor(country)
  const current = typeof value === 'string' ? value : ''
  const selected = findSubdivision(country, current)

  if (!descriptor.subdivisions.length) {
    return (
      <Input
        id={id}
        value={current}
        onChange={(evt) => setValue(evt.target.value)}
        disabled={disabled}
        aria-label={labels.region}
        aria-invalid={error ? 'true' : undefined}
      />
    )
  }

  return (
    <Select
      // A channel saved before the picker existed can hold the full state name; it preselects its
      // state without the stored value being rewritten.
      value={selected?.code ?? undefined}
      onValueChange={(next) => setValue(next ?? '')}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        className={error ? 'border-destructive' : undefined}
        aria-label={labels.region}
        aria-invalid={error ? 'true' : undefined}
      >
        <SelectValue placeholder={labels.region} />
      </SelectTrigger>
      <SelectContent>
        {descriptor.subdivisions.map((entry) => (
          <SelectItem key={entry.code} value={entry.code}>
            {entry.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function useChannelFieldLabels() {
  const t = useT()
  const descriptor = useChannelAddressDescriptor()
  const marketLabel = React.useCallback(
    (profileKey: string, legacyKey: string, hostLabel: string) =>
      (profileKey === legacyKey ? hostLabel : t(profileKey, hostLabel)),
    [t],
  )
  return React.useMemo(() => ({
    name: t('sales.channels.form.name', 'Channel name'),
    code: t('sales.channels.form.code', 'Code'),
    description: t('sales.channels.form.description', 'Description'),
    websiteUrl: t('sales.channels.form.websiteUrl', 'Website URL'),
    contactEmail: t('sales.channels.form.contactEmail', 'Contact email'),
    contactPhone: t('sales.channels.form.contactPhone', 'Contact phone'),
    statusEntryId: t('sales.channels.form.status', 'Status entry ID'),
    addressLine1: t('sales.channels.form.address1', 'Address line 1'),
    addressLine2: t('sales.channels.form.address2', 'Address line 2'),
    city: t('sales.channels.form.city', 'City'),
    region: marketLabel(
      descriptor.subdivisionLabelKey,
      LEGACY_DISPLAY_DEFAULTS.subdivisionLabelKey,
      t('sales.channels.form.region', 'State / region'),
    ),
    postalCode: marketLabel(
      descriptor.postalCodeLabelKey,
      LEGACY_DISPLAY_DEFAULTS.postalCodeLabelKey,
      t('sales.channels.form.postalCode', 'Postal code'),
    ),
    country: t('sales.channels.form.country', 'Country'),
    latitude: t('sales.channels.form.latitude', 'Latitude'),
    longitude: t('sales.channels.form.longitude', 'Longitude'),
    isActive: t('sales.channels.form.isActive', 'Active'),
  }), [descriptor, marketLabel, t])
}

export function useChannelFields(): { fields: CrudField[]; groups: CrudFormGroup[] } {
  const t = useT()
  const labels = useChannelFieldLabels()
  const descriptor = useChannelAddressDescriptor()
  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'name', label: labels.name, type: 'text', required: true },
    {
      id: 'code',
      label: labels.code,
      type: 'text',
      description: 'Lowercase letters, numbers, and dashes.',
      required: true,
    },
    {
      id: 'description',
      label: labels.description,
      type: 'textarea',
    },
    {
      id: 'websiteUrl',
      label: labels.websiteUrl,
      type: 'text',
    },
    {
      id: 'contactEmail',
      label: labels.contactEmail,
      type: 'text',
    },
    {
      id: 'contactPhone',
      label: labels.contactPhone,
      type: 'text',
    },
    {
      id: 'addressLine1',
      label: labels.addressLine1,
      type: 'text',
    },
    {
      id: 'addressLine2',
      label: labels.addressLine2,
      type: 'text',
    },
    {
      id: 'city',
      label: labels.city,
      type: 'text',
      layout: 'half',
    },
    {
      // `id`, `label` and `layout` are unchanged, so the address group definition and any injected
      // widget targeting `region` are unaffected by the switch to a custom control.
      id: 'region',
      label: labels.region,
      type: 'custom',
      layout: 'half',
      component: (props: CrudCustomFieldRenderProps) => <ChannelRegionField {...props} />,
    },
    {
      id: 'postalCode',
      label: labels.postalCode,
      type: 'text',
      layout: 'half',
    },
    {
      id: 'country',
      label: labels.country,
      type: 'text',
      layout: 'half',
      placeholder: descriptor.defaultCountryCode ?? 'US',
    },
    {
      id: 'latitude',
      label: labels.latitude,
      type: 'number',
      layout: 'half',
    },
    {
      id: 'longitude',
      label: labels.longitude,
      type: 'number',
      layout: 'half',
    },
    {
      id: 'isActive',
      label: labels.isActive,
      type: 'checkbox',
    },
  ], [descriptor.defaultCountryCode, labels])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'general',
      title: t('sales.channels.form.groups.general', 'General'),
      column: 1,
      fields: ['name', 'code', 'description', 'isActive'],
    },
    {
      id: 'contact',
      title: t('sales.channels.form.groups.contact', 'Contact'),
      column: 1,
      fields: ['websiteUrl', 'contactEmail', 'contactPhone'],
    },
    {
      id: 'address',
      title: t('sales.channels.form.groups.address', 'Location'),
      column: 2,
      fields: ['addressLine1', 'addressLine2', 'city', 'region', 'postalCode', 'country', 'latitude', 'longitude'],
    },
  ], [t])

  return { fields, groups }
}

export function buildChannelPayload(values: ChannelFormValues): Record<string, unknown> {
  const pick = (value: unknown, opts?: { lowercase?: boolean }) => {
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim()
    if (!trimmed.length) return undefined
    return opts?.lowercase ? trimmed.toLowerCase() : trimmed
  }
  const toNumber = (value: unknown) => {
    if (value === null || value === undefined || value === '') return undefined
    const num = Number(value)
    return Number.isFinite(num) ? num : undefined
  }
  return {
    name: pick(values.name) ?? '',
    code: pick(values.code, { lowercase: true }),
    description: pick(values.description),
    websiteUrl: pick(values.websiteUrl),
    contactEmail: pick(values.contactEmail),
    contactPhone: pick(values.contactPhone),
    statusEntryId: pick(values.statusEntryId),
    addressLine1: pick(values.addressLine1),
    addressLine2: pick(values.addressLine2),
    city: pick(values.city),
    region: pick(values.region),
    postalCode: pick(values.postalCode),
    country: pick(values.country),
    latitude: toNumber(values.latitude),
    longitude: toNumber(values.longitude),
    isActive: values.isActive !== false,
  }
}
