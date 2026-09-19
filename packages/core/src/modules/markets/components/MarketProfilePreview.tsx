"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatMoney } from '@open-mercato/shared/lib/display/money'
import { formatDate, formatDateTime, formatTime } from '@open-mercato/shared/lib/display/datetime'
import { formatAddress } from '@open-mercato/shared/lib/display/address'
import { formatPhone } from '@open-mercato/shared/lib/display/phone'
import { formatLength, formatWeight } from '@open-mercato/shared/lib/display/units'
import { profileFromFormValues } from './profileFromValues'

/**
 * A fixed sample, so the preview changes only when a setting changes.
 *
 * The values are the ones the spec's acceptance scenario names, which makes the preview a direct
 * read on whether the US market is configured the way that scenario expects.
 */
const SAMPLE_INSTANT = '2026-10-18T15:45:00.000Z'
const SAMPLE_AMOUNT = '48250'
const SAMPLE_PHONE = '+12145550100'
const SAMPLE_LENGTH_IN = 330
const SAMPLE_WEIGHT_KG = 562.5
const SAMPLE_ADDRESS = {
  companyName: 'Ridgeview Collision',
  addressLine1: '1200 Industrial Blvd',
  addressLine2: 'Suite 4',
  buildingNumber: null,
  flatNumber: null,
  city: 'Plano',
  region: 'TX',
  postalCode: '75074-2210',
  country: 'US',
}

type PreviewRowProps = {
  label: string
  children: React.ReactNode
}

function PreviewRow({ label, children }: PreviewRowProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{children}</span>
    </div>
  )
}

export function MarketProfilePreview({ values }: { values: Record<string, unknown> }) {
  const t = useT()
  const profile = React.useMemo(() => profileFromFormValues(values), [values])
  const address = React.useMemo(() => formatAddress(SAMPLE_ADDRESS, profile), [profile])

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">{t('markets.preview.caption')}</p>
      <div className="grid grid-cols-2 gap-4">
        <PreviewRow label={t('markets.preview.date')}>{formatDate(SAMPLE_INSTANT, profile) ?? '-'}</PreviewRow>
        <PreviewRow label={t('markets.preview.time')}>{formatTime(SAMPLE_INSTANT, profile) ?? '-'}</PreviewRow>
        <PreviewRow label={t('markets.preview.dateTime')}>{formatDateTime(SAMPLE_INSTANT, profile) ?? '-'}</PreviewRow>
        <PreviewRow label={t('markets.preview.money')}>
          {formatMoney(SAMPLE_AMOUNT, profile.currencyCode, profile) ?? '-'}
        </PreviewRow>
        <PreviewRow label={t('markets.preview.phone')}>{formatPhone(SAMPLE_PHONE, profile) ?? '-'}</PreviewRow>
        <PreviewRow label={t('markets.preview.length')}>
          {formatLength(SAMPLE_LENGTH_IN, 'in', profile) ?? '-'}
        </PreviewRow>
        <PreviewRow label={t('markets.preview.weight')}>
          {formatWeight(SAMPLE_WEIGHT_KG, 'kg', profile) ?? '-'}
        </PreviewRow>
      </div>
      <PreviewRow label={t('markets.preview.address')}>
        <span className="flex flex-col">
          {address.lines.map((line, index) => (
            <span key={`${index}-${line}`}>{line}</span>
          ))}
        </span>
      </PreviewRow>
    </div>
  )
}

export default MarketProfilePreview
