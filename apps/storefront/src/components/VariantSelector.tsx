'use client'

import * as React from 'react'
import type { ProductVariant } from '@/lib/types'

type OptionSchema = {
  options: Array<{
    code: string
    label: string
    values: Array<{ code: string; label: string }>
  }>
}

type VariantSelectorProps = {
  optionSchema: Record<string, unknown> | null
  variants: ProductVariant[]
  selectedVariant: ProductVariant | null
  onVariantChange: (variant: ProductVariant) => void
}

export function VariantSelector({
  optionSchema,
  variants,
  selectedVariant,
  onVariantChange,
}: VariantSelectorProps) {
  const schema = optionSchema as OptionSchema | null
  const [selectedOptions, setSelectedOptions] = React.useState<Record<string, string>>(() => {
    if (selectedVariant) return { ...selectedVariant.optionValues }
    const defaultVariant = variants.find((v) => v.isDefault && v.isActive) ?? variants[0]
    return defaultVariant ? { ...defaultVariant.optionValues } : {}
  })

  React.useEffect(() => {
    const matched = variants.find((v) =>
      Object.entries(selectedOptions).every(([k, val]) => v.optionValues[k] === val)
    )
    if (matched && matched.id !== selectedVariant?.id) {
      onVariantChange(matched)
    }
  }, [selectedOptions, variants, selectedVariant, onVariantChange])

  if (!schema?.options?.length || variants.length <= 1) return null

  const handleOptionChange = (optionCode: string, valueCode: string) => {
    setSelectedOptions((prev) => ({ ...prev, [optionCode]: valueCode }))
  }

  const isValueAvailable = (optionCode: string, valueCode: string): boolean => {
    const testOptions = { ...selectedOptions, [optionCode]: valueCode }
    return variants.some((v) =>
      Object.entries(testOptions).every(([k, val]) => v.optionValues[k] === val) && v.isActive
    )
  }

  return (
    <div className="space-y-4">
      {schema.options.map((option) => {
        const currentValue = selectedOptions[option.code]
        return (
          <div key={option.code}>
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-900">
              <span>{option.label}</span>
              {currentValue && (
                <span className="text-gray-400 font-normal">
                  {option.values.find((v) => v.code === currentValue)?.label ?? currentValue}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {option.values.map((value) => {
                const available = isValueAvailable(option.code, value.code)
                const selected = currentValue === value.code
                return (
                  <button
                    key={value.code}
                    onClick={() => available && handleOptionChange(option.code, value.code)}
                    disabled={!available}
                    className={`min-w-10 rounded-lg border px-3 py-2 text-sm transition-all ${
                      selected
                        ? 'border-gray-900 bg-gray-900 text-white'
                        : available
                          ? 'border-gray-200 text-gray-700 hover:border-gray-400'
                          : 'border-gray-100 text-gray-300 cursor-not-allowed line-through'
                    }`}
                    aria-pressed={selected}
                    aria-disabled={!available}
                  >
                    {value.label}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
