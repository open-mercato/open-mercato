"use client"

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Plus, Settings } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
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
import { buildCountryOptions } from '@open-mercato/shared/lib/location/countries'
import { buildHrefWithReturnTo } from '@open-mercato/shared/lib/navigation/returnTo'
import { resolveTaxIdLabel, type AddressFormatStrategy } from '../utils/addressFormat'
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
  /**
   * Contact details that belong to the ADDRESS rather than to the customer: the tax identifier it was
   * invoiced under, and the phone a carrier calls about a delivery. Optional so every existing caller
   * keeps compiling — one that omits them renders two empty fields, exactly as it does for `region`.
   */
  taxId?: string
  /**
   * Which scheme the identifier belongs to, in Stripe's `{country}_{kind}` vocabulary. Chosen, not
   * inferred: `PL1234567890` and `1234567890` are the same business written two ways, and a rule
   * that reads the form of the value is guessing — the more schemes the vocabulary carries, the more
   * often it guesses wrong, and a wrong type is worse than none because it names the number.
   */
  taxIdType?: string
  phone?: string
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
  | 'taxId'
  | 'taxIdType'
  | 'phone'
  | 'latitude'
  | 'longitude'
  | 'isPrimary'

type AddressEditorProps = {
  value: AddressEditorDraft
  onChange: (next: AddressEditorDraft) => void
  format: AddressFormatStrategy
  t: Translator
  disabled?: boolean
  errors?: Partial<Record<AddressEditorField, string>>
  hidePrimaryToggle?: boolean
  /**
   * Interprets `taxId` for its label only — a `pl_nip` reads "NIP", an `eu_vat` reads "EU VAT". It is
   * metadata about the value, never an edited field, which is why it is a prop rather than a member
   * of the draft: nothing in this component may write it.
   */
  showFormatHint?: boolean
  showCoordinateFields?: boolean
  /**
   * Render the tax identifier and phone. Off by default, and opt-in for the same reason
   * `showCoordinateFields` is: only a caller whose storage can hold a field should offer it. The
   * sales document snapshot is schemaless and keeps both; `CustomerAddress` has neither column until
   * Phase 3, so the address book would present two inputs it silently drops on save.
   *
   * This gates the CALLER, not the field. Inside a tile that opts in, both render whether or not they
   * carry a value and take the same `disabled` as every neighbour.
   */
  showContactFields?: boolean
}

/**
 * The schemes offered in the picker, in the order a Polish deployment meets them. The vocabulary is
 * additive under the backward-compatibility contract, so a new scheme is a new entry here rather
 * than a new branch in a rule that has to guess.
 *
 * The labels are the ones `resolveTaxIdLabel` resolves, so the picker and the marker beside the
 * filled field always read the same.
 */
const TAX_ID_TYPES = ['pl_nip', 'eu_vat', 'gb_vat', 'other'] as const

export function AddressEditor({
  value,
  onChange,
  format,
  t,
  disabled = false,
  errors = {},
  hidePrimaryToggle = false,
  showFormatHint = true,
  showCoordinateFields = false,
  showContactFields = false,
}: AddressEditorProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
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

  // One mapping, one home. The picker's options resolve through `resolveTaxIdLabel`, so a scheme
  // cannot be called one thing in the list and another wherever else an identifier is named.
  const taxIdLabels = {
    plNip: t('customers.people.detail.addresses.fields.taxId.plNip', 'Tax ID'),
    euVat: t('customers.people.detail.addresses.fields.taxId.euVat', 'EU VAT'),
    gbVat: t('customers.people.detail.addresses.fields.taxId.gbVat', 'GB VAT'),
    other: t('customers.people.detail.addresses.fields.taxId.other', 'Tax number'),
  }
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
    taxId: value.taxId ?? '',
    taxIdType: value.taxIdType ?? '',
    phone: value.phone ?? '',
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
    () => buildHrefWithReturnTo('/backend/config/customers', returnTo),
    [returnTo],
  )

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
      errors[field] ? 'border-status-error-border focus:ring-status-error-border' : 'border-input bg-background',
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
                    ? t('customers.people.detail.addresses.types.loading', 'Loading…')
                    : t('customers.people.detail.addresses.types.placeholder', 'Address type')
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
              href={manageAddressTypesHref}
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
                    <Button
                      key={option.code}
                      variant="ghost"
                      size="sm"
                      className="w-full justify-between rounded-none font-normal"
                      onClick={() => {
                        update('country', option.code)
                        setCountryDialogOpen(false)
                        setCountryQuery('')
                      }}
                    >
                      <span className="truncate">{option.label}</span>
                      <span className="text-xs text-muted-foreground">{option.code}</span>
                    </Button>
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
        {showCoordinateFields ? (
          <>
            <Input
              className={inputClass('latitude')}
              placeholder={t('customers.people.detail.addresses.fields.latitude', 'Latitude')}
              aria-label={t('customers.people.detail.addresses.fields.latitude', 'Latitude')}
              inputMode="decimal"
              value={current.latitude ?? ''}
              onChange={(evt) => update('latitude', evt.target.value)}
              disabled={disabled}
              aria-invalid={errors.latitude ? 'true' : undefined}
            />
            {errors.latitude ? <p className="text-xs text-destructive">{errors.latitude}</p> : null}
            <Input
              className={inputClass('longitude')}
              placeholder={t('customers.people.detail.addresses.fields.longitude', 'Longitude')}
              aria-label={t('customers.people.detail.addresses.fields.longitude', 'Longitude')}
              inputMode="decimal"
              value={current.longitude ?? ''}
              onChange={(evt) => update('longitude', evt.target.value)}
              disabled={disabled}
              aria-invalid={errors.longitude ? 'true' : undefined}
            />
            {errors.longitude ? <p className="text-xs text-destructive">{errors.longitude}</p> : null}
          </>
        ) : null}
        {/*
          Ordinary fields, not a block rendered beside the editor. An address's tax identifier and
          phone are as much part of it as its street, so they render always and edit the same way —
          whether the address can be edited at all is a property of the address, not decided per
          field. Whether they appear at all is the CALLER's answer, above.
        */}
        {showContactFields ? (
        <>
        <div className="flex gap-2">
          {/*
            The scheme is picked, not inferred. Reading it off the form of the value works for the
            three seeded cases and stops working as the vocabulary grows — and a wrong type is worse
            than none, because it puts a name on the number. Stripe asks for the same choice.
          */}
          <Select
            value={current.taxIdType || undefined}
            onValueChange={(next) => update('taxIdType', next ?? '')}
            disabled={disabled}
          >
            <SelectTrigger
              className={`shrink-0 basis-1/3 ${errors.taxIdType ? 'border-destructive' : ''}`}
              aria-invalid={errors.taxIdType ? 'true' : undefined}
            >
              <SelectValue
                placeholder={t('customers.people.detail.addresses.fields.taxIdType', 'Tax id type')}
              />
            </SelectTrigger>
            <SelectContent>
              {TAX_ID_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {resolveTaxIdLabel(taxIdLabels, type)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className={inputClass('taxId')}
            placeholder={t('customers.people.detail.addresses.fields.taxId', 'Tax number')}
            value={current.taxId ?? ''}
            onChange={(evt) => update('taxId', evt.target.value)}
            disabled={disabled}
            aria-invalid={errors.taxId ? 'true' : undefined}
          />
        </div>
        {errors.taxId ? <p className="text-xs text-destructive">{errors.taxId}</p> : null}
        <Input
          className={inputClass('phone')}
          placeholder={t('customers.people.detail.addresses.fields.phone', 'Phone')}
          // Same reason as the tax id above: the placeholder is this field's only label, and it
          // disappears the moment someone types. A phone left bare sits directly under the postcode,
          // and `81 333-53-64` beside `96-534` gives a reader nothing to tell them apart by. Constant,
          // not resolved: a phone has no type to interpret.
          rightIcon={
            current.phone ? (
              <span className="text-xs">{t('customers.people.detail.addresses.fields.phone', 'Phone')}</span>
            ) : null
          }
          inputMode="tel"
          value={current.phone ?? ''}
          onChange={(evt) => update('phone', evt.target.value)}
          disabled={disabled}
          aria-invalid={errors.phone ? 'true' : undefined}
        />
        {errors.phone ? <p className="text-xs text-destructive">{errors.phone}</p> : null}
        </>
        ) : null}
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
