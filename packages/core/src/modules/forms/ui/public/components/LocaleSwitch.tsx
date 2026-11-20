"use client"

import * as React from 'react'
import { Globe } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type LocaleSwitchProps = {
  locales: string[]
  value: string
  onChange: (next: string) => void
}

export function LocaleSwitch({ locales, value, onChange }: LocaleSwitchProps) {
  const t = useT()
  if (!locales || locales.length <= 1) return null
  const ariaLabel = t('forms.runner.locale.label', { fallback: 'Language' })
  return (
    <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <Globe aria-hidden="true" className="h-4 w-4" />
      <span className="sr-only">{ariaLabel}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={ariaLabel} className="h-8 min-w-24">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {locales.map((locale) => (
            <SelectItem key={locale} value={locale}>
              {locale.toUpperCase()}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
