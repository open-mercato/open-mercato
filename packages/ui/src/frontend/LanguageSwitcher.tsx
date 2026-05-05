"use client"
import { useId, useTransition } from 'react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { useRouter } from 'next/navigation'
import { locales, type Locale } from '@open-mercato/shared/lib/i18n/config'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'

export function LanguageSwitcher() {
  const current = useLocale()
  const t = useT()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const selectId = useId()

  const languageLabels: Record<Locale, string> = {
    en: t('common.languages.english', 'English'),
    pl: t('common.languages.polish', 'Polski'),
    es: t('common.languages.spanish', 'Español'),
    de: t('common.languages.german', 'Deutsch'),
  }

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
          {locales.map((locale) => (
            <SelectItem key={locale} value={locale}>
              {languageLabels[locale]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
