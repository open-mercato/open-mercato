"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type OrgOption = {
  id: string
  label: string
  depth: number
}

export type OrgSwitcherProps = {
  options: OrgOption[]
  selectedId: string | null
  onChange: (next: string) => void
}

export function OrgSwitcher({ options, selectedId, onChange }: OrgSwitcherProps) {
  const t = useT()
  if (options.length <= 1) return null
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      <span>{t('customer_accounts.domainMapping.orgSwitcher.label', 'Organization')}</span>
      <select
        className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        value={selectedId ?? ''}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((opt) => {
          const indent = opt.depth > 0 ? '  '.repeat(opt.depth) : ''
          return (
            <option key={opt.id} value={opt.id}>
              {indent}
              {opt.label}
            </option>
          )
        })}
      </select>
    </label>
  )
}

export default OrgSwitcher
