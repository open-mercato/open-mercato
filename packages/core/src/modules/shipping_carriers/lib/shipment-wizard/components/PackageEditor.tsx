"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useDisplayProfile } from '@open-mercato/ui/backend/markets/MarketProfileProvider'
import { convertUnit } from '@open-mercato/shared/lib/display/units'
import { withProfile } from '@open-mercato/shared/lib/display/profile'
import type { PackageDimension, PackageEditorProps } from '../types'

const PACKAGE_FIELDS = ['weightKg', 'lengthCm', 'widthCm', 'heightCm'] as const

const DEFAULT_PACKAGE: PackageDimension = { weightKg: 1, lengthCm: 20, widthCm: 15, heightCm: 10 }

/**
 * The stored unit of each field. `PackageDimension` is metric by contract - the carrier adapters
 * receive kilograms and centimetres (spec decision D9) - so the market only ever changes what the
 * merchant TYPES, never what is sent.
 */
const FIELD_BASE_UNIT: Record<keyof PackageDimension, string> = {
  weightKg: 'kg',
  lengthCm: 'cm',
  widthCm: 'cm',
  heightCm: 'cm',
}

const FIELD_DIMENSION: Record<keyof PackageDimension, 'mass' | 'length'> = {
  weightKg: 'mass',
  lengthCm: 'length',
  widthCm: 'length',
  heightCm: 'length',
}

function roundForInput(value: number): number {
  return Math.round(value * 100) / 100
}

export const PackageEditor = (props: PackageEditorProps) => {
  const { packages, onChange, disabled } = props
  const t = useT()
  const profile = withProfile(useDisplayProfile())

  // One `convertUnit` call per field at the input boundary, and nowhere else: a US merchant reads
  // and types pounds and inches while the payload stays kilograms and centimetres.
  const displayUnit = React.useCallback(
    (field: keyof PackageDimension) =>
      (FIELD_DIMENSION[field] === 'mass' ? profile.defaultWeightUnit : profile.defaultLengthUnit),
    [profile.defaultLengthUnit, profile.defaultWeightUnit],
  )

  const toDisplay = React.useCallback(
    (field: keyof PackageDimension, stored: number): number => {
      const converted = convertUnit(stored, FIELD_BASE_UNIT[field], displayUnit(field))
      return converted === null ? stored : roundForInput(converted)
    },
    [displayUnit],
  )

  const toStored = React.useCallback(
    (field: keyof PackageDimension, typed: number): number => {
      const converted = convertUnit(typed, displayUnit(field), FIELD_BASE_UNIT[field])
      return converted === null ? typed : converted
    },
    [displayUnit],
  )

  const fieldLabel = (field: keyof PackageDimension) => {
    const unit = displayUnit(field)
    const labels: Record<keyof PackageDimension, string> = {
      weightKg: t('shipping_carriers.create.package.weight', 'Weight ({unit})', { unit }),
      lengthCm: t('shipping_carriers.create.package.length', 'Length ({unit})', { unit }),
      widthCm: t('shipping_carriers.create.package.width', 'Width ({unit})', { unit }),
      heightCm: t('shipping_carriers.create.package.height', 'Height ({unit})', { unit }),
    }
    return labels[field]
  }

  const updatePackage = (index: number, field: keyof PackageDimension, raw: string) => {
    const typed = parseFloat(raw)
    const stored = Number.isNaN(typed) ? 0 : toStored(field, typed)
    onChange(packages.map((pkg, idx) =>
      idx === index ? { ...pkg, [field]: stored } : pkg,
    ))
  }

  const addPackage = () => onChange([...packages, DEFAULT_PACKAGE])

  const removePackage = (index: number) => onChange(packages.filter((_, idx) => idx !== index))

  return (
    <div className="space-y-3">
      {packages.map((pkg, index) => (
        <div key={index} className="rounded-lg border bg-muted/30 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              {t('shipping_carriers.create.package.label', 'Package')} {index + 1}
            </span>
            {packages.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto px-2 py-0.5 text-xs text-destructive hover:text-destructive/80"
                onClick={() => removePackage(index)}
                disabled={disabled}
              >
                {t('shipping_carriers.create.package.remove', 'Remove')}
              </Button>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            {PACKAGE_FIELDS.map((field) => (
              <div key={field}>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  {fieldLabel(field)}
                </label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={toDisplay(field, pkg[field])}
                  onChange={(event) => updatePackage(index, field, event.target.value)}
                  disabled={disabled}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addPackage} disabled={disabled}>
        {t('shipping_carriers.create.package.add', '+ Add package')}
      </Button>
    </div>
  )
}
