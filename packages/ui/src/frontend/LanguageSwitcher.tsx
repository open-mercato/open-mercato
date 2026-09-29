"use client"
import { useId, useTransition } from 'react'
import { useLocale, useLocaleLocked, useSupportedLocales, useT } from '@open-mercato/shared/lib/i18n/context'
import { useRouter } from 'next/navigation'
import type { Locale } from '@open-mercato/shared/lib/i18n/config'
import { resolveLocaleLabel } from '@open-mercato/shared/lib/i18n/locale-label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'

export function LanguageSwitcher() {
  const current = useLocale()
  const localeLocked = useLocaleLocked()
  const supportedLocales = useSupportedLocales()
  const t = useT()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const selectId = useId()

  async function setLocale(locale: Locale) {
    if (locale === current) return
    try {
      const res = await fetch('/api/auth/locale', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale }),
      })
      if (!res.ok) return
      startTransition(() => router.refresh())
      try {
        window.dispatchEvent(new Event('om:refresh-sidebar'))
      } catch {
        // Ignore if window is unavailable
      }
    } catch {
      // Ignore network errors; UX fallback keeps previous locale
    }
  }

  // Locale is pinned via OM_FORCE_LOCALE — switching is a no-op, so hide the control.
  if (localeLocked) return null

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <label htmlFor={selectId}>{t('common.language')}</label>
      <Select
        value={current}
        onValueChange={(value) => setLocale(value as Locale)}
        disabled={pending}
      >
        <SelectTrigger id={selectId} size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {supportedLocales.map((locale) => (
            <SelectItem key={locale} value={locale}>
              {resolveLocaleLabel(locale, t)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
