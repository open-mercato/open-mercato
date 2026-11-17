"use client"
import * as React from 'react'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type PolicyScope = {
  productId: string
  variantId: string
  storeId: string
}

/**
 * Product/variant/store target fields, kept as controlled local state
 * (outside `CrudForm`'s own field list) so a value change can drive the live
 * resolution-chain preview immediately — `CrudForm` does not expose a
 * live-values callback. Rendered via `CrudForm`'s `contentHeader` slot.
 */
export function ScopeFields({ value, onChange, disabled }: { value: PolicyScope; onChange: (next: PolicyScope) => void; disabled?: boolean }) {
  const t = useT()
  return (
    <div className="grid grid-cols-1 gap-4 rounded-md border p-4 sm:grid-cols-3">
      <div className="space-y-1.5">
        <Label htmlFor="availability-policy-product-id">{t('availability.policies.form.field.productId')}</Label>
        <Input
          id="availability-policy-product-id"
          value={value.productId}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, productId: e.target.value.trim() })}
          placeholder={t('availability.policies.form.field.productId.placeholder')}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="availability-policy-variant-id">{t('availability.policies.form.field.variantId')}</Label>
        <Input
          id="availability-policy-variant-id"
          value={value.variantId}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, variantId: e.target.value.trim() })}
          placeholder={t('availability.policies.form.field.variantId.placeholder')}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="availability-policy-store-id">{t('availability.policies.form.field.storeId')}</Label>
        <Input
          id="availability-policy-store-id"
          value={value.storeId}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, storeId: e.target.value.trim() })}
          placeholder={t('availability.policies.form.field.storeId.placeholder')}
        />
      </div>
    </div>
  )
}
