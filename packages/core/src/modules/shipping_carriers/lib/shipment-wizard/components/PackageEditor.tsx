"use client"

import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { PackageDimension, PackageEditorProps } from '../types'

const PACKAGE_FIELDS = ['weightKg', 'lengthCm', 'widthCm', 'heightCm'] as const

const DEFAULT_PACKAGE: PackageDimension = { weightKg: 1, lengthCm: 20, widthCm: 15, heightCm: 10 }

export const PackageEditor = (props: PackageEditorProps) => {
  const { packages, onChange, disabled } = props
  const t = useT()

  const fieldLabel = (field: keyof PackageDimension) => {
    const labels: Record<keyof PackageDimension, string> = {
      weightKg: t('shipping_carriers.create.package.weightKg', 'Weight (kg)'),
      lengthCm: t('shipping_carriers.create.package.lengthCm', 'Length (cm)'),
      widthCm: t('shipping_carriers.create.package.widthCm', 'Width (cm)'),
      heightCm: t('shipping_carriers.create.package.heightCm', 'Height (cm)'),
    }
    return labels[field]
  }

  const updatePackage = (index: number, field: keyof PackageDimension, raw: string) => {
    const value = parseFloat(raw)
    onChange(packages.map((pkg, idx) =>
      idx === index ? { ...pkg, [field]: Number.isNaN(value) ? 0 : value } : pkg,
    ))
  }

  const addPackage = () => onChange([...packages, DEFAULT_PACKAGE])

  const removePackage = (index: number) => onChange(packages.filter((_, idx) => idx !== index))

  return (
    <div className="space-y-3">
      {packages.map((pkg, index) => (
        <div key={index} className="rounded-lg border bg-muted/20 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              {t('shipping_carriers.create.package.label', 'Package')} {index + 1}
            </span>
            {packages.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto px-2 py-0.5 text-xs text-red-600 hover:text-red-700"
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
                  value={pkg[field]}
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
