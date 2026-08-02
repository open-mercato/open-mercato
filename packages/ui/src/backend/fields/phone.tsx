"use client"

import * as React from 'react'
import type { CrudCustomFieldRenderProps } from '../CrudForm'
import { FieldRegistry } from './registry'
import { PhoneNumberField, PHONE_COUNTRIES } from '../inputs/PhoneNumberField'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemLeading,
  SelectTrigger,
  SelectValue,
} from '../../primitives/select'

type PhoneFieldConfig = {
  defaultCountryIso2?: string
}

type PhoneFieldDef = PhoneFieldConfig & {
  configJson?: PhoneFieldConfig
}

type PhoneFieldInputProps = CrudCustomFieldRenderProps & { def?: PhoneFieldDef }

// Sentinel used by the definition editor to represent "no fixed default"
// because Radix Select cannot use an empty string as an item value.
const AUTO_COUNTRY_VALUE = '__om_phone_auto__'

function PhoneFieldInput({ id, value, setValue, disabled, error, def }: PhoneFieldInputProps) {
  const stringValue = typeof value === 'string' ? value : value == null ? '' : String(value)
  return (
    <PhoneNumberField
      id={id}
      value={stringValue}
      onValueChange={(next) => setValue(next ?? undefined)}
      disabled={disabled}
      externalError={error ?? null}
      defaultCountryIso2={def?.defaultCountryIso2}
    />
  )
}

function PhoneFieldDefEditor({
  def,
  onChange,
}: {
  def: { configJson?: PhoneFieldConfig } | undefined
  onChange: (patch: Partial<PhoneFieldConfig>) => void
}) {
  const t = useT()
  const selected = typeof def?.configJson?.defaultCountryIso2 === 'string' ? def.configJson.defaultCountryIso2 : ''
  return (
    <div className="mt-3 space-y-3 rounded border border-dashed border-muted-foreground/40 bg-muted/30 p-3">
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t('ui.customFields.phone.defaultCountry', 'Default country')}
        </label>
        <Select
          value={selected || AUTO_COUNTRY_VALUE}
          onValueChange={(next) => onChange({ defaultCountryIso2: next === AUTO_COUNTRY_VALUE ? undefined : next })}
        >
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value={AUTO_COUNTRY_VALUE}>
              {t('ui.customFields.phone.defaultCountryAuto', 'Auto-detect from value')}
            </SelectItem>
            {PHONE_COUNTRIES.map((country) => (
              <SelectItem key={`${country.iso2}-${country.dialCode}`} value={country.iso2}>
                <SelectItemLeading>
                  <span className="text-base leading-none">{country.flag}</span>
                </SelectItemLeading>
                <span className="flex-1 truncate">{country.label}</span>
                <span className="ml-2 text-xs text-muted-foreground tabular-nums">{country.dialCode}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {t(
            'ui.customFields.phone.defaultCountryHint',
            'Pre-selects a country in the phone editor when the field is empty.',
          )}
        </p>
      </div>
    </div>
  )
}

FieldRegistry.register('phone', {
  input: (props) => <PhoneFieldInput {...props} />,
  defEditor: (props) => <PhoneFieldDefEditor {...props} />,
})

export {}
