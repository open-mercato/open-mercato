"use client"

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Plus, Settings } from 'lucide-react'
import { Button } from '../../primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@open-mercato/ui/primitives/dialog'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { buildCountryOptions } from '@open-mercato/shared/lib/location/countries'
import { buildHrefWithReturnTo } from '@open-mercato/shared/lib/navigation/returnTo'
import {
  addressDisplayProfile,
  isValidPostalCode,
  resolveAddressLayout,
} from '@open-mercato/shared/lib/display/address'
import { isValidSubdivision } from '@open-mercato/shared/lib/location/subdivisions'
import { LEGACY_DISPLAY_DEFAULTS, type DisplayProfile } from '@open-mercato/shared/lib/display/profile'
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
  latitude?: string
  longitude?: string
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
  | 'latitude'
  | 'longitude'
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
  showCoordinateFields?: boolean
  addressTypesAdapter?: AddressTypesAdapter<C>
  addressTypesContext?: C
  /**
   * The organization's market display profile. Its layout, labels, subdivision list and postal-code
   * pattern win over `format` when present; without it the editor renders exactly as before.
   */
  profile?: DisplayProfile | null
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
  showCoordinateFields = false,
  addressTypesAdapter,
  addressTypesContext,
  profile,
}: AddressEditorProps<C>) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
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
    ...(showCoordinateFields
      ? { latitude: value.latitude ?? '', longitude: value.longitude ?? '' }
      : {}),
    isPrimary: value.isPrimary ?? false,
  }

  const update = React.useCallback(
    (key: keyof AddressEditorDraft, nextValue: string | boolean) => {
      onChange({ ...current, [key]: nextValue })
    },
    [current, onChange],
  )

  const descriptor = React.useMemo(
    () => resolveAddressLayout(addressDisplayProfile(format, profile)),
    [format, profile],
  )

  // A market with a home country should not make every merchant type it on every address. Seeded at
  // most once per mounted country, so a host that ignores `onChange` cannot turn this into a loop.
  const seededCountryRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    const defaultCountry = descriptor.defaultCountryCode
    if (disabled || !defaultCountry) return
    if (current.country.trim().length) return
    if (seededCountryRef.current === defaultCountry) return
    seededCountryRef.current = defaultCountry
    update('country', defaultCountry)
  }, [current.country, descriptor.defaultCountryCode, disabled, update])

  /**
   * The market's label when it renamed the field, and the host's own label otherwise.
   *
   * The frozen defaults carry a neutral key for every market-agnostic field, and an organization
   * that never picked a market must keep the exact strings it reads today - so an unchanged key
   * means "nothing to say about this field", not "render the markets dictionary instead".
   */
  const marketLabel = React.useCallback(
    (profileKey: string, legacyKey: string, hostLabel: string) =>
      (profileKey === legacyKey ? hostLabel : t(profileKey, hostLabel)),
    [t],
  )

  const regionLabel = marketLabel(
    descriptor.subdivisionLabelKey,
    LEGACY_DISPLAY_DEFAULTS.subdivisionLabelKey,
    label('fields.region', 'Region'),
  )
  const postalCodeLabel = marketLabel(
    descriptor.postalCodeLabelKey,
    LEGACY_DISPLAY_DEFAULTS.postalCodeLabelKey,
    label('fields.postalCode', 'Postal code'),
  )
  const addressLine2Label = marketLabel(
    descriptor.addressLine2LabelKey,
    LEGACY_DISPLAY_DEFAULTS.addressLine2LabelKey,
    label('fields.line2', 'Address line 2'),
  )

  const effectiveCountry = current.country.trim() || descriptor.defaultCountryCode
  // Warnings, never errors: a display setting must not make data that predates it unsaveable.
  const subdivisionWarning =
    descriptor.subdivisions.length > 0
    && current.region.trim().length > 0
    && !isValidSubdivision(effectiveCountry, current.region)
  const postalCodeWarning = !isValidPostalCode(current.postalCode, descriptor.postalCodePattern)

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
  const returnTo = React.useMemo(() => {
    const query = searchParams?.toString() ?? ''
    if (!pathname) return null
    return query.length ? `${pathname}?${query}` : pathname
  }, [pathname, searchParams])
  const manageAddressTypesHref = React.useMemo(
    () => buildHrefWithReturnTo(addressTypesAdapter?.manageHref ?? '/backend/config/dictionaries', returnTo),
    [addressTypesAdapter?.manageHref, returnTo],
  )

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
      'w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      errors[field] ? 'border-red-500 aria-invalid:ring-destructive' : 'border-input bg-background',
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
          <Select
            value={current.purpose || undefined}
            onValueChange={(next) => update('purpose', next ?? '')}
            disabled={disabled}
          >
            <SelectTrigger
              className={errors.purpose ? 'border-destructive' : undefined}
              aria-invalid={errors.purpose ? 'true' : undefined}
            >
              <SelectValue
                placeholder={
                  addressTypesLoading
                    ? label('types.loading', 'Loading…')
                    : label('types.placeholder', 'Address type')
                }
              />
            </SelectTrigger>
            <SelectContent>
              {addressTypes.map((entry) => (
                <SelectItem key={entry.value} value={entry.value}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
              href={manageAddressTypesHref}
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

      {descriptor.layout === 'street_first' ? (
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
        placeholder={addressLine2Label}
        value={current.addressLine2}
        onChange={(evt) => update('addressLine2', evt.target.value)}
        disabled={disabled}
        aria-invalid={errors.addressLine2 ? 'true' : undefined}
      />

      {descriptor.layout !== 'street_first' && descriptor.showBuildingAndFlatNumber ? (
        <div className="grid gap-2 sm:grid-cols-[1.5fr,0.7fr,0.7fr]">
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
        {descriptor.subdivisions.length ? (
          <Select
            value={current.region || undefined}
            onValueChange={(next) => update('region', next ?? '')}
            disabled={disabled}
          >
            <SelectTrigger
              className={errors.region ? 'border-destructive' : undefined}
              aria-invalid={errors.region ? 'true' : undefined}
              aria-label={regionLabel}
            >
              <SelectValue placeholder={regionLabel} />
            </SelectTrigger>
            <SelectContent>
              {descriptor.subdivisions.map((entry) => (
                <SelectItem key={entry.code} value={entry.code}>
                  {entry.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            className={inputClass('region')}
            placeholder={regionLabel}
            value={current.region}
            onChange={(evt) => update('region', evt.target.value)}
            disabled={disabled}
            aria-invalid={errors.region ? 'true' : undefined}
          />
        )}
      </div>
      {subdivisionWarning ? (
        <StatusBadge variant="warning">
          {t('markets.address.warning.subdivision', 'This state is not in the list for the selected country. The record still saves.')}
        </StatusBadge>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          className={inputClass('postalCode')}
          placeholder={postalCodeLabel}
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
              <div className="max-h-64 overflow-auto rounded-md border border-border/70">
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
      {postalCodeWarning ? (
        <StatusBadge variant="warning">
          {t('markets.address.warning.postalCode', 'This postal code does not match the market pattern. The record still saves.')}
        </StatusBadge>
      ) : null}

      {showCoordinateFields ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              className={inputClass('latitude')}
              placeholder={label('fields.latitude', 'Latitude')}
              aria-label={label('fields.latitude', 'Latitude')}
              inputMode="decimal"
              value={current.latitude ?? ''}
              onChange={(evt) => update('latitude', evt.target.value)}
              disabled={disabled}
              aria-invalid={errors.latitude ? 'true' : undefined}
            />
            <Input
              className={inputClass('longitude')}
              placeholder={label('fields.longitude', 'Longitude')}
              aria-label={label('fields.longitude', 'Longitude')}
              inputMode="decimal"
              value={current.longitude ?? ''}
              onChange={(evt) => update('longitude', evt.target.value)}
              disabled={disabled}
              aria-invalid={errors.longitude ? 'true' : undefined}
            />
          </div>
          {errors.latitude ? <p className="text-xs text-destructive">{errors.latitude}</p> : null}
          {errors.longitude ? <p className="text-xs text-destructive">{errors.longitude}</p> : null}
        </>
      ) : null}

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
