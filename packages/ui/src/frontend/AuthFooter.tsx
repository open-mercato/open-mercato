"use client"
import { usePathname } from 'next/navigation'
import { LanguageSwitcher } from './LanguageSwitcher'

export function AuthFooter() {
  const pathname = usePathname()
  const shouldShow =
    pathname === '/login' ||
    (typeof pathname === 'string' && pathname.startsWith('/onboarding'))
  if (!shouldShow) return null
  return (
    <footer className="fixed bottom-0 left-0 right-0 w-full border-t bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/50 z-50">
      <div className="max-w-screen-lg mx-auto px-4 py-3 flex items-center justify-end">
        <LanguageSwitcher />
      </div>
    </footer>
  )
}
