"use client"

import * as React from 'react'
import Link from 'next/link'
import { Plus, Settings } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
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
import type { AddressFormatStrategy } from '../utils/addressFormat'
import { useAddressTypes } from './detail/hooks/useAddressTypes'

type Translator = (key: string, fallback?: string, params?: Record<string, string | number>) => string

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

type AddressEditorProps = {
  value: AddressEditorDraft
  onChange: (next: AddressEditorDraft) => void
  format: AddressFormatStrategy
  t: Translator
  disabled?: boolean
  errors?: Partial<Record<AddressEditorField, string>>
  hidePrimaryToggle?: boolean
  showFormatHint?: boolean
}

export function AddressEditor({
  value,
  onChange,
  format,
  t,
  disabled = false,
  errors = {},
  hidePrimaryToggle = false,
  showFormatHint = true,
}: AddressEditorProps) {
  const { options: addressTypes, loading: addressTypesLoading, error: addressTypeError, createType } = useAddressTypes(t)
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
        setTypeFormError(t('customers.people.detail.addresses.types.emptyError', 'Please provide a value'))
        return
      }
      setTypeFormError(null)
      await createType(trimmed)
      setTypeDialogOpen(false)
      setTypeValue('')
    },
    [createType, t, typeValue],
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
          placeholder={t('customers.people.detail.addresses.fields.label', 'Label')}
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
                ? t('customers.people.detail.addresses.types.loading', 'Loading…')
                : t('customers.people.detail.addresses.types.placeholder', 'Address type')}
            </option>
            {addressTypes.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
          <Dialog open={typeDialogOpen} onOpenChange={setTypeDialogOpen}>
            <DialogTrigger asChild>
              <Button type="button" variant="outline" size="icon" className="shrink-0" disabled={disabled}>
                <Plus className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{t('customers.people.detail.addresses.types.add', 'Add address type')}</DialogTitle>
                <DialogDescription>
                  {t('customers.people.detail.addresses.types.addHint', 'Create a new address type for reuse.')}
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
                  placeholder={t('customers.people.detail.addresses.types.placeholder', 'Address type')}
                  disabled={disabled}
                  aria-invalid={typeFormError ? 'true' : undefined}
                />
                {typeFormError ? <p className="text-sm text-destructive">{typeFormError}</p> : null}
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setTypeDialogOpen(false)} disabled={disabled}>
                    {t('customers.people.detail.addresses.types.cancel', 'Cancel')}
                  </Button>
                  <Button type="submit" disabled={disabled || !typeValue.trim()}>
                    {t('customers.people.detail.addresses.types.save', 'Save')}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <Button
            asChild
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0"
            disabled={disabled}
            title={t('customers.people.detail.addresses.types.manage', 'Manage address types')}
          >
            <Link
              href="/backend/config/customers"
              aria-label={t('customers.people.detail.addresses.types.manage', 'Manage address types')}
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
        placeholder={t('customers.people.detail.addresses.fields.companyName', 'Company name')}
        value={current.companyName}
        onChange={(evt) => update('companyName', evt.target.value)}
        disabled={disabled}
        aria-invalid={errors.companyName ? 'true' : undefined}
      />
      {showFormatHint ? (
        <p className="text-xs text-muted-foreground">
          {format === 'street_first'
            ? t('customers.people.detail.addresses.streetFormatHint', 'Street-first layout is active.')
            : t('customers.people.detail.addresses.lineFormatHint', 'Address-line layout is active.')}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input
          className={inputClass('addressLine1')}
          placeholder={
            format === 'street_first'
              ? t('customers.people.detail.addresses.fields.street', 'Street')
              : t('customers.people.detail.addresses.fields.line1', 'Address line 1')
          }
          value={current.addressLine1}
          onChange={(evt) => update('addressLine1', evt.target.value)}
          disabled={disabled}
          aria-invalid={errors.addressLine1 ? 'true' : undefined}
        />
        {errors.addressLine1 ? <p className="text-xs text-destructive sm:col-span-2">{errors.addressLine1}</p> : null}
        {format === 'street_first' ? (
          <>
            <Input
              className={inputClass('buildingNumber')}
              placeholder={t('customers.people.detail.addresses.fields.buildingNumber', 'Building number')}
              value={current.buildingNumber}
              onChange={(evt) => update('buildingNumber', evt.target.value)}
              disabled={disabled}
              aria-invalid={errors.buildingNumber ? 'true' : undefined}
            />
            <Input
              className={inputClass('flatNumber')}
              placeholder={t('customers.people.detail.addresses.fields.flatNumber', 'Flat number')}
              value={current.flatNumber}
              onChange={(evt) => update('flatNumber', evt.target.value)}
              disabled={disabled}
              aria-invalid={errors.flatNumber ? 'true' : undefined}
            />
            <Input
              className={inputClass('addressLine2')}
              placeholder={t('customers.people.detail.addresses.fields.streetExtra', 'Address line 2')}
              value={current.addressLine2}
              onChange={(evt) => update('addressLine2', evt.target.value)}
              disabled={disabled}
              aria-invalid={errors.addressLine2 ? 'true' : undefined}
            />
            {errors.addressLine2 ? <p className="text-xs text-destructive sm:col-span-2">{errors.addressLine2}</p> : null}
          </>
        ) : (
          <>
            <Input
              className={inputClass('addressLine2')}
              placeholder={t('customers.people.detail.addresses.fields.line2', 'Address line 2')}
              value={current.addressLine2}
              onChange={(evt) => update('addressLine2', evt.target.value)}
              disabled={disabled}
              aria-invalid={errors.addressLine2 ? 'true' : undefined}
            />
            {errors.addressLine2 ? <p className="text-xs text-destructive sm:col-span-2">{errors.addressLine2}</p> : null}
          </>
        )}
        <Input
          className={inputClass('city')}
          placeholder={t('customers.people.detail.addresses.fields.city', 'City')}
          value={current.city}
          onChange={(evt) => update('city', evt.target.value)}
          disabled={disabled}
          aria-invalid={errors.city ? 'true' : undefined}
        />
        {errors.city ? <p className="text-xs text-destructive">{errors.city}</p> : null}
        <Input
          className={inputClass('region')}
          placeholder={t('customers.people.detail.addresses.fields.region', 'Region/state')}
          value={current.region}
          onChange={(evt) => update('region', evt.target.value)}
          disabled={disabled}
          aria-invalid={errors.region ? 'true' : undefined}
        />
        {errors.region ? <p className="text-xs text-destructive">{errors.region}</p> : null}
        <Input
          className={inputClass('postalCode')}
          placeholder={t('customers.people.detail.addresses.fields.postalCode', 'Postal code')}
          value={current.postalCode}
          onChange={(evt) => update('postalCode', evt.target.value)}
          disabled={disabled}
          aria-invalid={errors.postalCode ? 'true' : undefined}
        />
        {errors.postalCode ? <p className="text-xs text-destructive">{errors.postalCode}</p> : null}
        <Dialog
          open={countryDialogOpen}
          onOpenChange={(open) => {
            setCountryDialogOpen(open)
            if (!open) setCountryQuery('')
          }}
        >
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className={`${inputClass('country')} h-10 w-full justify-between`}
              disabled={disabled}
              aria-invalid={errors.country ? 'true' : undefined}
            >
              <span className="truncate text-left">
                {selectedCountry
                  ? `${selectedCountry.label}`
                  : t('customers.people.detail.addresses.countryPlaceholder', 'Select country')}
              </span>
              <span className="ml-2 text-xs text-muted-foreground">
                {selectedCountry ? selectedCountry.code : null}
              </span>
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t('customers.people.detail.addresses.countryDialogTitle', 'Select country')}</DialogTitle>
              <DialogDescription>
                {t('customers.people.detail.addresses.countryDialogDescription', 'Search and choose an ISO country code.')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                placeholder={t('customers.people.detail.addresses.countrySearch', 'Search country')}
                value={countryQuery}
                onChange={(evt) => setCountryQuery(evt.target.value)}
              />
              <div className="max-h-64 overflow-y-auto rounded border divide-y">
                {filteredCountryOptions.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-muted-foreground">
                    {t('customers.people.detail.addresses.countryEmpty', 'No matches found')}
                  </p>
                ) : (
                  filteredCountryOptions.map((option) => (
                    <button
                      key={option.code}
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-sm text-left hover:bg-muted"
                      onClick={() => {
                        update('country', option.code)
                        setCountryDialogOpen(false)
                        setCountryQuery('')
                      }}
                    >
                      <span className="truncate">{option.label}</span>
                      <span className="text-xs text-muted-foreground">{option.code}</span>
                    </button>
                  ))
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    update('country', '')
                    setCountryDialogOpen(false)
                    setCountryQuery('')
                  }}
                  disabled={disabled}
                >
                  {t('customers.people.detail.addresses.countryClear', 'Clear')}
                </Button>
                <Button type="button" onClick={() => setCountryDialogOpen(false)}>
                  {t('customers.people.detail.addresses.countryClose', 'Done')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        {errors.country ? <p className="text-xs text-destructive">{errors.country}</p> : null}
      </div>
      {!hidePrimaryToggle ? (
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={current.isPrimary}
            onChange={(evt) => update('isPrimary', evt.target.checked)}
            disabled={disabled}
            aria-invalid={errors.isPrimary ? 'true' : undefined}
          />
          <span>{t('customers.people.detail.addresses.fields.primary', 'Set as primary')}</span>
        </label>
      ) : null}
      {errors.isPrimary ? <p className="text-xs text-destructive">{errors.isPrimary}</p> : null}
    </div>
  )
}

export default AddressEditor
