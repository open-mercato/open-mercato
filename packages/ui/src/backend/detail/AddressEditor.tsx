"use client"

import * as React from 'react'
import Link from 'next/link'
import { Plus, Settings } from 'lucide-react'
import { Button } from '../../primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@open-mercato/ui/primitives/dialog'
import { buildCountryOptions } from '@open-mercato/shared/lib/location/countries'
import { cn } from '@open-mercato/shared/lib/utils'
import type { AddressFormatStrategy } from './addressFormat'

type Translator = (key: string, fallback?: string, params?: Record<string, string | number>) => string

export type AddressTypeOption = {
  value: string
  label: string
}

export type AddressTypesAdapter<C = unknown> = {
  list: (context?: C) => Promise<AddressTypeOption[]>
  create?: (value: string, context?: C) => Promise<AddressTypeOption | null>
  manageHref?: string
}

export type AddressEditorDraft = {
  name: string
  purpose: string
  companyName: string
  addressLine1: string
  addressLine2: string
  buildingNumber: string
  flatNumber: string
  city: string
  region: string
  postalCode: string
  country: string
  isPrimary: boolean
}

export type AddressEditorField =
  | 'name'
  | 'purpose'
  | 'companyName'
  | 'addressLine1'
  | 'addressLine2'
  | 'buildingNumber'
  | 'flatNumber'
  | 'city'
  | 'region'
  | 'postalCode'
  | 'country'
  | 'isPrimary'

type AddressEditorProps<C = unknown> = {
  value: AddressEditorDraft
  onChange: (next: AddressEditorDraft) => void
  format: AddressFormatStrategy
  t: Translator
  labelPrefix?: string
  disabled?: boolean
  errors?: Partial<Record<AddressEditorField, string>>
  hidePrimaryToggle?: boolean
  showFormatHint?: boolean
  addressTypesAdapter?: AddressTypesAdapter<C>
  addressTypesContext?: C
}

export function AddressEditor<C = unknown>({
  value,
  onChange,
  format,
  t,
  labelPrefix = 'customers.people.detail.addresses',
  disabled = false,
  errors = {},
  hidePrimaryToggle = false,
  showFormatHint = true,
  addressTypesAdapter,
  addressTypesContext,
}: AddressEditorProps<C>) {
  const label = React.useCallback(
    (suffix: string, fallback?: string, params?: Record<string, string | number>) =>
      t(`${labelPrefix}.${suffix}`, fallback, params),
    [labelPrefix, t],
  )

  const [addressTypes, setAddressTypes] = React.useState<AddressTypeOption[]>([])
  const [addressTypesLoading, setAddressTypesLoading] = React.useState(false)
  const [addressTypeError, setAddressTypeError] = React.useState<string | null>(null)

  const [typeDialogOpen, setTypeDialogOpen] = React.useState(false)
  const [typeValue, setTypeValue] = React.useState('')
  const [typeFormError, setTypeFormError] = React.useState<string | null>(null)
  const [countryDialogOpen, setCountryDialogOpen] = React.useState(false)
  const [countryQuery, setCountryQuery] = React.useState('')

  const countryOptions = React.useMemo(
    () =>
      buildCountryOptions({
        transformLabel: (code, fallback) => t(`customers.countries.${code.toLowerCase()}`, fallback ?? code),
      }),
    [t],
  )

  React.useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!addressTypesAdapter) {
        setAddressTypes([])
        setAddressTypeError(null)
        return
      }
      setAddressTypesLoading(true)
      try {
        const result = await addressTypesAdapter.list(addressTypesContext)
        if (!cancelled) {
          setAddressTypes(Array.isArray(result) ? result : [])
          setAddressTypeError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setAddressTypes([])
          setAddressTypeError(label('types.loadError', 'Failed to load address types'))
        }
      } finally {
        if (!cancelled) setAddressTypesLoading(false)
      }
    }
    load().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [addressTypesAdapter, addressTypesContext, label])

  const current: AddressEditorDraft = {
    name: value.name ?? '',
    purpose: value.purpose ?? '',
    companyName: value.companyName ?? '',
    addressLine1: value.addressLine1 ?? '',
    addressLine2: value.addressLine2 ?? '',
    buildingNumber: value.buildingNumber ?? '',
    flatNumber: value.flatNumber ?? '',
    city: value.city ?? '',
    region: value.region ?? '',
    postalCode: value.postalCode ?? '',
    country: value.country ?? '',
    isPrimary: value.isPrimary ?? false,
  }

  const update = React.useCallback(
    (key: keyof AddressEditorDraft, nextValue: string | boolean) => {
      onChange({ ...current, [key]: nextValue })
    },
    [current, onChange],
  )

  const filteredCountryOptions = React.useMemo(() => {
    const query = countryQuery.trim().toLowerCase()
    if (!query.length) return countryOptions
    return countryOptions.filter(
      (option) => option.label.toLowerCase().includes(query) || option.code.toLowerCase().includes(query),
    )
  }, [countryOptions, countryQuery])

  const selectedCountry = React.useMemo(() => {
    const code = (current.country ?? '').toUpperCase()
    if (!code.length) return null
    return countryOptions.find((option) => option.code === code) ?? null
  }, [countryOptions, current.country])

  const handleTypeSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const trimmed = typeValue.trim()
      if (!trimmed.length) {
        setTypeFormError(label('types.emptyError', 'Please provide a value'))
        return
      }
      if (!addressTypesAdapter?.create) return
      setTypeFormError(null)
      const created = await addressTypesAdapter.create(trimmed, addressTypesContext)
      if (created) {
        setAddressTypes((prev) => {
          const map = new Map(prev.map((entry) => [entry.value, entry]))
          map.set(created.value, created)
          return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label))
        })
      }
      setTypeDialogOpen(false)
      setTypeValue('')
    },
    [addressTypesAdapter, addressTypesContext, label, typeValue],
  )

  const inputClass = (field: AddressEditorField) =>
    [
      'w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring',
      errors[field] ? 'border-red-500 focus:ring-red-500' : 'border-input bg-background',
    ].join(' ')

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          className={inputClass('name')}
          placeholder={label('fields.label', 'Label')}
          value={current.name}
          onChange={(evt) => update('name', evt.target.value)}
          disabled={disabled}
          aria-invalid={errors.name ? 'true' : undefined}
        />
        <div className="flex gap-2">
          <select
            className={inputClass('purpose')}
            value={current.purpose}
            onChange={(evt) => update('purpose', evt.target.value)}
            disabled={disabled}
            aria-invalid={errors.purpose ? 'true' : undefined}
          >
            <option value="">
              {addressTypesLoading
                ? label('types.loading', 'Loading…')
                : label('types.placeholder', 'Address type')}
            </option>
            {addressTypes.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
          {addressTypesAdapter?.create ? (
            <Dialog open={typeDialogOpen} onOpenChange={setTypeDialogOpen}>
              <DialogTrigger asChild>
                <Button type="button" variant="outline" size="icon" className="shrink-0" disabled={disabled}>
                  <Plus className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>{label('types.add', 'Add address type')}</DialogTitle>
                  <DialogDescription>
                    {label('types.addHint', 'Create a new address type for reuse.')}
                  </DialogDescription>
                </DialogHeader>
                <form className="space-y-3" onSubmit={handleTypeSubmit}>
                  <Input
                    autoFocus
                    value={typeValue}
                    onChange={(evt) => {
                      setTypeValue(evt.target.value)
                      if (typeFormError) setTypeFormError(null)
                    }}
                    placeholder={label('types.placeholder', 'Address type')}
                    disabled={disabled}
                    aria-invalid={typeFormError ? 'true' : undefined}
                  />
                  {typeFormError ? <p className="text-sm text-destructive">{typeFormError}</p> : null}
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setTypeDialogOpen(false)} disabled={disabled}>
                      {label('types.cancel', 'Cancel')}
                    </Button>
                    <Button type="submit" disabled={disabled || !typeValue.trim()}>
                      {label('types.save', 'Save')}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          ) : null}
          <Button
            asChild
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0"
            disabled={disabled}
            title={label('types.manage', 'Manage address types')}
          >
            <Link
              href={addressTypesAdapter?.manageHref ?? '/backend/config/dictionaries'}
              aria-label={label('types.manage', 'Manage address types')}
            >
              <Settings className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
      {errors.purpose ? <p className="text-xs text-destructive">{errors.purpose}</p> : null}
      {addressTypeError ? <p className="text-xs text-destructive">{addressTypeError}</p> : null}
      <Input
        className={inputClass('companyName')}
        placeholder={label('fields.companyName', 'Company name')}
        value={current.companyName}
        onChange={(evt) => update('companyName', evt.target.value)}
        disabled={disabled}
        aria-invalid={errors.companyName ? 'true' : undefined}
      />

      {format === 'street_first' ? (
        <div className="grid gap-2 sm:grid-cols-[1.5fr,0.7fr,0.7fr]">
          <Input
            className={inputClass('addressLine1')}
            placeholder={label('fields.street', 'Street')}
            value={current.addressLine1}
            onChange={(evt) => update('addressLine1', evt.target.value)}
            disabled={disabled}
            aria-invalid={errors.addressLine1 ? 'true' : undefined}
          />
          <Input
            className={inputClass('buildingNumber')}
            placeholder={label('fields.buildingNumber', 'Building number')}
            value={current.buildingNumber}
            onChange={(evt) => update('buildingNumber', evt.target.value)}
            disabled={disabled}
            aria-invalid={errors.buildingNumber ? 'true' : undefined}
          />
          <Input
            className={inputClass('flatNumber')}
            placeholder={label('fields.flatNumber', 'Flat number')}
            value={current.flatNumber}
            onChange={(evt) => update('flatNumber', evt.target.value)}
            disabled={disabled}
            aria-invalid={errors.flatNumber ? 'true' : undefined}
          />
        </div>
      ) : (
        <Input
          className={inputClass('addressLine1')}
          placeholder={label('fields.line1', 'Address line 1')}
          value={current.addressLine1}
          onChange={(evt) => update('addressLine1', evt.target.value)}
          disabled={disabled}
          aria-invalid={errors.addressLine1 ? 'true' : undefined}
        />
      )}

      <Input
        className={inputClass('addressLine2')}
        placeholder={label('fields.line2', 'Address line 2')}
        value={current.addressLine2}
        onChange={(evt) => update('addressLine2', evt.target.value)}
        disabled={disabled}
        aria-invalid={errors.addressLine2 ? 'true' : undefined}
      />

      {format !== 'street_first' ? (
        <div className="grid gap-2 sm:grid-cols-[1.5fr,0.7fr,0.7fr]">
          <Input
            className={inputClass('addressLine1')}
            placeholder={label('fields.street', 'Street')}
            value={current.addressLine1}
            onChange={(evt) => update('addressLine1', evt.target.value)}
            disabled={disabled}
            aria-invalid={errors.addressLine1 ? 'true' : undefined}
          />
          <Input
            className={inputClass('buildingNumber')}
            placeholder={label('fields.buildingNumber', 'Building number')}
            value={current.buildingNumber}
            onChange={(evt) => update('buildingNumber', evt.target.value)}
            disabled={disabled}
            aria-invalid={errors.buildingNumber ? 'true' : undefined}
          />
          <Input
            className={inputClass('flatNumber')}
            placeholder={label('fields.flatNumber', 'Flat number')}
            value={current.flatNumber}
            onChange={(evt) => update('flatNumber', evt.target.value)}
            disabled={disabled}
            aria-invalid={errors.flatNumber ? 'true' : undefined}
          />
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          className={inputClass('city')}
          placeholder={label('fields.city', 'City')}
          value={current.city}
          onChange={(evt) => update('city', evt.target.value)}
          disabled={disabled}
          aria-invalid={errors.city ? 'true' : undefined}
        />
        <Input
          className={inputClass('region')}
          placeholder={label('fields.region', 'Region')}
          value={current.region}
          onChange={(evt) => update('region', evt.target.value)}
          disabled={disabled}
          aria-invalid={errors.region ? 'true' : undefined}
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          className={inputClass('postalCode')}
          placeholder={label('fields.postalCode', 'Postal code')}
          value={current.postalCode}
          onChange={(evt) => update('postalCode', evt.target.value)}
          disabled={disabled}
          aria-invalid={errors.postalCode ? 'true' : undefined}
        />
        <Dialog open={countryDialogOpen} onOpenChange={setCountryDialogOpen}>
          <DialogTrigger asChild>
            <Button type="button" variant="ghost" className={cn(inputClass('country'), 'cursor-pointer')} disabled={disabled}>
              {selectedCountry?.label ?? label('fields.country', 'Country')}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{label('country.title', 'Choose a country')}</DialogTitle>
              <DialogDescription>{label('country.subtitle', 'Search for a country')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                placeholder={label('country.search', 'Search countries')}
                value={countryQuery}
                onChange={(evt) => setCountryQuery(evt.target.value)}
              />
              <div className="max-h-64 overflow-auto rounded-md border border-border/60">
                <ul className="divide-y divide-border/50">
                  {filteredCountryOptions.map((option) => (
                    <li key={option.code}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-between font-normal rounded-none"
                        onClick={() => {
                          update('country', option.code)
                          setCountryDialogOpen(false)
                        }}
                      >
                        <span>{option.label}</span>
                        <span className="text-xs text-muted-foreground">{option.code}</span>
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {showFormatHint ? (
        <p className="text-xs text-muted-foreground">
          {label('formatHint', 'Format based on address settings')}
        </p>
      ) : null}

      {!hidePrimaryToggle ? (
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={current.isPrimary}
            onChange={(evt) => update('isPrimary', evt.target.checked)}
            disabled={disabled}
          />
          {label('fields.primary', 'Primary address')}
        </label>
      ) : null}
    </div>
  )
}

export default AddressEditor
