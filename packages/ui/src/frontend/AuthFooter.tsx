"use client"
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useT } from '@/lib/i18n/context'
import { LanguageSwitcher } from './LanguageSwitcher'

export function AuthFooter() {
  const pathname = usePathname()
  const t = useT()
  const shouldShow =
    pathname === '/login' ||
    (typeof pathname === 'string' && pathname.startsWith('/onboarding'))
  if (!shouldShow) return null
  return (
    <footer className="w-full border-t bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/50">
      <div className="max-w-screen-lg mx-auto px-4 py-3 flex flex-wrap items-center justify-end gap-4">
        <nav className="flex items-center gap-3 text-xs text-muted-foreground">
          <Link href="/terms" className="transition hover:text-foreground">
            {t('common.terms')}
          </Link>
          <Link href="/privacy" className="transition hover:text-foreground">
            {t('common.privacy')}
          </Link>
        </nav>
        <LanguageSwitcher />
      </div>
    </footer>
  )
}
