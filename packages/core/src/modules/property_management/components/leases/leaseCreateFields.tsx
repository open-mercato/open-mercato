"use client"

import * as React from 'react'
import { Lock } from 'lucide-react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { LookupSelect, type LookupSelectItem } from '@open-mercato/ui/backend/inputs/LookupSelect'
import { Input } from '@open-mercato/ui/primitives/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { leaseEndsOn, respondByDate } from '../../lib/leaseTerm'
import { formatDate, formatMoney } from './leaseModel'

export type AvailableUnit = {
  id: string
  name: string
  buildingName: string | null
  floorName: string | null
  spaceName: string | null
  productName: string | null
  priceAmount: string | null
  currencyCode: string | null
}

type FieldProps = {
  value: unknown
  setValue: (value: unknown) => void
  values?: Record<string, unknown>
  setFormValue?: (id: string, value: unknown) => void
  disabled?: boolean
}

const NO_UNIT = '__none__'

function readText(values: Record<string, unknown> | undefined, key: string): string | null {
  const value = values?.[key]
  return typeof value === 'string' && value.length ? value : null
}

export function readPositiveInt(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null
}

export function computeEndsOn(startsOn: string | null, months: number | null): string | null {
  if (!startsOn || !months || !/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) return null
  try {
    return leaseEndsOn(startsOn, months)
  } catch {
    return null
  }
}

export function useAvailableUnits(startsOn: string | null, termMonths: number | null, buildingId: string | null) {
  const [units, setUnits] = React.useState<AvailableUnit[]>([])
  const [loading, setLoading] = React.useState(false)
  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams()
    if (startsOn && termMonths) {
      params.set('startsOn', startsOn)
      params.set('termMonths', String(termMonths))
    }
    if (buildingId) params.set('buildingId', buildingId)
    void apiCall<{ items?: AvailableUnit[] }>(`/api/property_management/leases/available-units?${params.toString()}`, undefined, { fallback: {} })
      .then((call) => {
        if (!cancelled) setUnits(call.ok && Array.isArray(call.result?.items) ? call.result.items : [])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [startsOn, termMonths, buildingId])
  return { units, loading }
}

export function UnitPickerField({ value, setValue, values, setFormValue, disabled }: FieldProps) {
  const t = useT()
  const locale = useLocale()
  const startsOn = readText(values, 'startsOn')
  const termMonths = readPositiveInt(values?.termMonths)
  const { units, loading } = useAvailableUnits(startsOn, termMonths, readText(values, 'buildingId'))
  const selectedId = typeof value === 'string' && value ? value : null
  const selected = units.find((unit) => unit.id === selectedId) ?? null

  React.useEffect(() => {
    if (!loading && selectedId && !selected) setValue(null)
  }, [loading, selected, selectedId, setValue])

  const pick = (next: string) => {
    if (next === NO_UNIT) {
      setValue(null)
      return
    }
    setValue(next)
    const unit = units.find((entry) => entry.id === next)
    if (unit?.priceAmount && !values?.monthlyRate) setFormValue?.('monthlyRate', Number(unit.priceAmount))
  }

  return (
    <div className="space-y-2">
      <Select value={selectedId ?? NO_UNIT} onValueChange={pick} disabled={disabled || loading}>
        <SelectTrigger aria-label={t('property_management.leases.form.unit', 'Unit')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_UNIT}>
            {units.length
              ? t('property_management.leases.form.unitPlaceholder', 'Choose a unit')
              : t('property_management.leases.form.noUnits', 'No leasable unit is free for this term')}
          </SelectItem>
          {units.map((unit) => (
            <SelectItem key={unit.id} value={unit.id}>
              {[unit.name, unit.buildingName, unit.floorName].filter(Boolean).join(' · ')}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selected ? (
        <p className="flex items-center gap-1 text-sm text-muted-foreground">
          <Lock className="size-3.5" aria-hidden />
          {t('property_management.leases.form.productLocked', 'Product: {product} — recorded on the lease, it does not follow later changes to the unit.', {
            product: selected.productName ?? '—',
          })}
          {selected.priceAmount ? ` · ${formatMoney(selected.priceAmount, selected.currencyCode, locale)}` : ''}
        </p>
      ) : null}
    </div>
  )
}

export function CompanyPickerField({ value, setValue, setFormValue, disabled }: FieldProps) {
  const t = useT()
  const fetchItems = React.useCallback(async (query: string): Promise<LookupSelectItem[]> => {
    const params = new URLSearchParams({ pageSize: '20' })
    if (query.trim()) params.set('search', query.trim())
    const call = await apiCall<{ items?: Array<{ id: string; display_name?: string | null; primary_email?: string | null }> }>(
      `/api/customers/companies?${params.toString()}`,
      undefined,
      { fallback: {} },
    )
    const items = call.ok && Array.isArray(call.result?.items) ? call.result.items : []
    return items.map((item) => ({ id: item.id, title: item.display_name ?? item.id, subtitle: item.primary_email ?? null }))
  }, [])
  return (
    <LookupSelect
      value={typeof value === 'string' && value ? value : null}
      onChange={(next) => {
        setValue(next)
        setFormValue?.('primaryContactPersonId', null)
      }}
      fetchItems={fetchItems}
      minQuery={0}
      disabled={disabled}
      placeholder={t('property_management.leases.form.tenantPlaceholder', 'Search CRM companies')}
    />
  )
}

export function ContactPickerField({ value, setValue, values, disabled }: FieldProps) {
  const t = useT()
  const companyId = readText(values, 'customerCompanyId')
  const [people, setPeople] = React.useState<Array<{ id: string; displayName: string }>>([])
  React.useEffect(() => {
    if (!companyId) {
      setPeople([])
      return
    }
    let cancelled = false
    void apiCall<{ items?: Array<{ id: string; displayName: string }> }>(
      `/api/customers/companies/${encodeURIComponent(companyId)}/people?pageSize=100`,
      undefined,
      { fallback: {} },
    ).then((call) => {
      if (!cancelled) setPeople(call.ok && Array.isArray(call.result?.items) ? call.result.items : [])
    })
    return () => {
      cancelled = true
    }
  }, [companyId])
  return (
    <Select value={typeof value === 'string' && value ? value : NO_UNIT} onValueChange={(next) => setValue(next === NO_UNIT ? null : next)} disabled={disabled || !companyId}>
      <SelectTrigger aria-label={t('property_management.leases.form.contact', 'Primary contact')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_UNIT}>{t('property_management.leases.form.contactNone', 'No primary contact')}</SelectItem>
        {people.map((person) => (
          <SelectItem key={person.id} value={person.id}>{person.displayName}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function TermSummaryField({ values }: FieldProps) {
  const t = useT()
  const locale = useLocale()
  const endsOn = computeEndsOn(readText(values, 'startsOn'), readPositiveInt(values?.termMonths))
  return (
    <p className="text-sm text-muted-foreground" data-testid="pm-lease-ends-on">
      {endsOn
        ? t('property_management.leases.form.endsOn', 'Ends {date}. Billed monthly on the anniversary of the start date.', { date: formatDate(endsOn, locale) })
        : t('property_management.leases.form.endsOnPending', 'Pick a start date and a term to see the end date.')}
    </p>
  )
}

export function ProposalExpiryField({ value, setValue, disabled }: FieldProps) {
  const t = useT()
  const locale = useLocale()
  const days = readPositiveInt(value)
  const respondBy = days && days <= 90 ? respondByDate(days) : null
  return (
    <div className="space-y-1">
      <Input
        type="number"
        min={1}
        max={90}
        value={value === null || value === undefined ? '' : String(value)}
        onChange={(event) => setValue(event.target.value === '' ? null : Number(event.target.value))}
        disabled={disabled}
        aria-label={t('property_management.leases.form.expiresInDays', 'Proposal expires after (days)')}
      />
      <p className="text-sm text-muted-foreground" data-testid="pm-lease-respond-by">
        {respondBy
          ? t('property_management.leases.form.respondBy', 'The customer must respond by {date}; after that the proposal expires and the unit is released.', {
              date: formatDate(respondBy, locale),
            })
          : t('property_management.leases.form.expiryRange', 'Between 1 and 90 days.')}
      </p>
    </div>
  )
}
