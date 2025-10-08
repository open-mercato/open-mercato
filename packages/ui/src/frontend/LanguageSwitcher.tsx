"use client"
import { useTransition } from 'react'
import { useLocale } from '@/lib/i18n/context'
import { useRouter } from 'next/navigation'

export function LanguageSwitcher() {
  const current = useLocale()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  async function setLocale(locale: 'en' | 'pl') {
    if (locale === current) return
    await fetch('/api/locale', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale })
    })
    startTransition(() => router.refresh())
  }

  const mkBtn = (loc: 'en'|'pl') => (
    <button
      key={loc}
      disabled={pending}
      onClick={() => setLocale(loc)}
      className={`px-2 py-1 rounded-md border text-xs ${current===loc ? 'bg-foreground text-background' : 'hover:bg-accent'}`}
      aria-current={current===loc}
    >
      {loc.toUpperCase()}
    </button>
  )

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>Language:</span>
      {mkBtn('en')}
      {mkBtn('pl')}
    </div>
  )
}

