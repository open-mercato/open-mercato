'use client'

// Generic field renderer shared by `RuleCard.tsx` and `BenefitCard.tsx` (Step 1.7) —
// reads one `FieldSpec` (`ruleFieldSpecs.ts`) and renders the matching DS primitive,
// so the eleven rule types and five benefit types do not each need hand-written JSX.

import * as React from 'react'
import { Input } from '@open-mercato/ui/primitives/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { comparisonOperatorValues } from '../data/validators'
import { discountTypeOptions, type ComparisonOperator, type DiscountTypeId } from './ruleTreeTypes'
import type { FieldSpec } from './ruleFieldSpecs'

const OPERATOR_LABEL_KEYS: Record<ComparisonOperator, string> = {
  eq: 'promotions.operators.eq',
  neq: 'promotions.operators.neq',
  gt: 'promotions.operators.gt',
  gte: 'promotions.operators.gte',
  lt: 'promotions.operators.lt',
  lte: 'promotions.operators.lte',
}

const OPERATOR_FALLBACKS: Record<ComparisonOperator, string> = {
  eq: 'Equals',
  neq: 'Not equal',
  gt: 'Greater than',
  gte: 'Greater than or equal',
  lt: 'Less than',
  lte: 'Less than or equal',
}

const DISCOUNT_TYPE_LABEL_KEYS: Record<DiscountTypeId, string> = {
  percentage: 'promotions.discountType.percentage',
  fixed: 'promotions.discountType.fixed',
}

const DISCOUNT_TYPE_FALLBACKS: Record<DiscountTypeId, string> = {
  percentage: 'Percentage',
  fixed: 'Fixed amount',
}

export type RuleFieldInputProps = {
  spec: FieldSpec
  value: unknown
  onChange: (next: unknown) => void
  disabled?: boolean
}

export function RuleFieldInput({ spec, value, onChange, disabled }: RuleFieldInputProps) {
  const t = useT()
  const label = t(spec.labelKey, spec.labelFallback)

  if (spec.kind === 'operator') {
    return (
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <Select value={String(value ?? 'eq')} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger size={36}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {comparisonOperatorValues.map((op) => (
              <SelectItem key={op} value={op}>
                {t(OPERATOR_LABEL_KEYS[op], OPERATOR_FALLBACKS[op])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    )
  }

  if (spec.kind === 'discountType') {
    return (
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <Select value={String(value ?? 'percentage')} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger size={36}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {discountTypeOptions.map((dt) => (
              <SelectItem key={dt} value={dt}>
                {t(DISCOUNT_TYPE_LABEL_KEYS[dt], DISCOUNT_TYPE_FALLBACKS[dt])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    )
  }

  if (spec.kind === 'checkbox') {
    return (
      <CheckboxField
        label={label}
        checked={Boolean(value)}
        onCheckedChange={(checked) => onChange(checked === true)}
        disabled={disabled}
      />
    )
  }

  const stringValue = value == null ? '' : String(value)
  const handleTextChange = (next: string) => {
    if (next === '' && spec.nullable) {
      onChange(null)
      return
    }
    if (spec.kind === 'number') {
      onChange(next === '' ? 0 : Number(next))
      return
    }
    onChange(next)
  }

  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Input
        type={spec.kind === 'number' ? 'number' : spec.kind === 'date' ? 'date' : 'text'}
        inputMode={spec.kind === 'decimal' ? 'decimal' : undefined}
        value={stringValue}
        onChange={(event) => handleTextChange(event.target.value)}
        disabled={disabled}
      />
    </label>
  )
}
