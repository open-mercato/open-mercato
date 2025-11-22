"use client"
import { useId, useTransition } from 'react'
import { useLocale, useT } from '@/lib/i18n/context'
import { useRouter } from 'next/navigation'
import { locales, type Locale } from '@/lib/i18n/config'

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
      const res = await fetch('/api/locale', {
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
      <div className="relative">
        <select
          id={selectId}
          className="appearance-none rounded-md border bg-background px-3 py-1 pr-8 text-xs focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:opacity-60"
          value={current}
          onChange={(event) => setLocale(event.target.value as Locale)}
          disabled={pending}
        >
          {locales.map((locale) => (
            <option key={locale} value={locale}>
              {languageLabels[locale]}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </div>
    </div>
  )
}
