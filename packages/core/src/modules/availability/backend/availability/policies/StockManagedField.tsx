"use client"
import * as React from 'react'
import type { CrudCustomFieldRenderProps, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'

export const ResolvedStockManagedContext = React.createContext<{ resolved: boolean | null; label: string }>({
  resolved: null,
  label: '',
})

export function resolveStockManagedValue(value: unknown, resolved: boolean | null): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof resolved === 'boolean') return resolved
  return undefined
}

function StockManagedCheckbox({ id, value, setValue, disabled }: CrudCustomFieldRenderProps) {
  const { resolved, label } = React.useContext(ResolvedStockManagedContext)
  const checked = resolveStockManagedValue(value, resolved) === true
  return (
    <label className="inline-flex cursor-pointer items-center gap-2">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(next) => setValue(next === true)}
        data-crud-focus-target=""
        disabled={disabled}
      />
      <span className="text-sm">{label}</span>
    </label>
  )
}

function renderStockManagedCheckbox(props: CrudCustomFieldRenderProps) {
  return <StockManagedCheckbox {...props} />
}

export function withResolvedStockManagedField(groups: CrudFormGroup[]): CrudFormGroup[] {
  return groups.map((group) => ({
    ...group,
    fields: group.fields?.map((field) => {
      if (typeof field === 'string' || field.id !== 'isStockManaged') return field
      return {
        id: field.id,
        type: 'custom' as const,
        label: '',
        description: field.description,
        component: renderStockManagedCheckbox,
      }
    }),
  }))
}
