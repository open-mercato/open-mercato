"use client"

import * as React from 'react'
import type { CrudField, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { useT } from '@/lib/i18n/context'

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

function useChannelFieldLabels() {
  const t = useT()
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
    region: t('sales.channels.form.region', 'State / region'),
    postalCode: t('sales.channels.form.postalCode', 'Postal code'),
    country: t('sales.channels.form.country', 'Country'),
    latitude: t('sales.channels.form.latitude', 'Latitude'),
    longitude: t('sales.channels.form.longitude', 'Longitude'),
    isActive: t('sales.channels.form.isActive', 'Active'),
  }), [t])
}

export function useChannelFields(): { fields: CrudField[]; groups: CrudFormGroup[] } {
  const t = useT()
  const labels = useChannelFieldLabels()
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
      id: 'region',
      label: labels.region,
      type: 'text',
      layout: 'half',
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
      placeholder: 'US',
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
  ], [labels])

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
