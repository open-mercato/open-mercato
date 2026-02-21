'use client'
import * as React from 'react'
import Link from 'next/link'
import { User, LogOut, Bell, Moon, Sun, Globe, Key, Check } from 'lucide-react'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { locales, type Locale } from '@open-mercato/shared/lib/i18n/config'
import { useTheme } from '@open-mercato/ui/theme'
import { Button } from '../primitives/button'
import { IconButton } from '../primitives/icon-button'

export type ProfileDropdownProps = {
  email?: string
  displayName?: string
  changePasswordHref?: string
  notificationsHref?: string
}

const localeLabels: Record<Locale, string> = {
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
  pl: 'Polski',
}

export function ProfileDropdown({
  email,
  displayName,
  changePasswordHref = '/backend/profile/change-password',
  notificationsHref,
}: ProfileDropdownProps) {
  const t = useT()
  const currentLocale = useLocale()
  const { resolvedTheme, setTheme } = useTheme()
  const [open, setOpen] = React.useState(false)
  const [languageOpen, setLanguageOpen] = React.useState(false)
  const [mounted, setMounted] = React.useState(false)
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  const isDark = resolvedTheme === 'dark'

  // Close on click outside
  React.useEffect(() => {
    if (!open) return
    function handleClick(event: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setOpen(false)
        setLanguageOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Close on Escape
  React.useEffect(() => {
    if (!open) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (languageOpen) {
          setLanguageOpen(false)
        } else {
          setOpen(false)
          buttonRef.current?.focus()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, languageOpen])

  const handleThemeToggle = () => {
    setTheme(isDark ? 'light' : 'dark')
  }

  const handleLocaleChange = async (locale: Locale) => {
    try {
      await fetch('/api/auth/locale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale }),
      })
      window.location.reload()
    } catch {}
  }

  const menuItemClass =
    'w-full text-left text-sm cursor-pointer px-3 py-2 rounded hover:bg-accent inline-flex items-center gap-2.5 outline-none focus-visible:ring-1 focus-visible:ring-ring'

  return (
    <div className="relative">
      <IconButton
        ref={buttonRef}
        variant="ghost"
        size="sm"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={email || t('ui.userMenu.userFallback', 'User')}
      >
        <User className="size-4" />
      </IconButton>

      {open && (
        <div
          ref={menuRef}
          className="absolute right-0 top-full mt-1 w-56 rounded-md border bg-background p-1 shadow-lg z-50"
          role="menu"
        >
          {/* User info header */}
          {(displayName || email) && (
            <div className="px-3 py-2.5 border-b mb-1">
              {displayName && (
                <div className="font-medium text-sm flex items-center gap-2">
                  <User className="size-4" />
                  {displayName}
                </div>
              )}
              {displayName && email && (
                <div className="text-xs text-muted-foreground mt-0.5 ml-6">{email}</div>
              )}
              {!displayName && email && (
                <div className="text-xs text-muted-foreground">
                  {t('ui.userMenu.loggedInAs', 'Logged in as:')} {email}
                </div>
              )}
            </div>
          )}

          <Link
            href={changePasswordHref}
            className={menuItemClass}
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            <Key className="size-4" />
            <span>{t('ui.profileMenu.changePassword', 'Change Password')}</span>
          </Link>

          {/* Notification Preferences */}
          {notificationsHref && (
            <Link
              href={notificationsHref}
              className={menuItemClass}
              role="menuitem"
              onClick={() => setOpen(false)}
            >
              <Bell className="size-4" />
              <span>{t('ui.profileMenu.notifications', 'Notification Preferences')}</span>
            </Link>
          )}

          <div className="my-1 border-t" />

          {/* Theme Toggle */}
          {mounted && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-between"
              role="menuitem"
              onClick={handleThemeToggle}
            >
              <span className="inline-flex items-center gap-2.5">
                {isDark ? <Moon className="size-4" /> : <Sun className="size-4" />}
                <span>{t('ui.profileMenu.theme', 'Dark Mode')}</span>
              </span>
              <div className={`w-8 h-4 rounded-full transition-colors ${isDark ? 'bg-primary' : 'bg-muted'} relative`}>
                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-background shadow transition-transform ${isDark ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
            </Button>
          )}

          {/* Language Selector */}
          <div className="relative">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-between"
              role="menuitem"
              onClick={() => setLanguageOpen(!languageOpen)}
              aria-expanded={languageOpen}
            >
              <span className="inline-flex items-center gap-2.5">
                <Globe className="size-4" />
                <span>{t('ui.profileMenu.language', 'Language')}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {localeLabels[currentLocale]}
              </span>
            </Button>

            {/* Language submenu - inline below */}
            {languageOpen && (
              <div className="mt-1 ml-6 space-y-0.5 border-l pl-2">
                {locales.map((locale) => (
                  <Button
                    key={locale}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={`w-full justify-start gap-2 ${locale === currentLocale ? 'text-primary font-medium' : ''}`}
                    onClick={() => handleLocaleChange(locale)}
                  >
                    <span>{localeLabels[locale]}</span>
                    {locale === currentLocale && <Check className="size-3.5" />}
                  </Button>
                ))}
              </div>
            )}
          </div>

          <div className="my-1 border-t" />

          {/* Sign Out */}
          <form action="/api/auth/logout" method="POST">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              type="submit"
              role="menuitem"
            >
              <LogOut className="size-4" />
              <span>{t('ui.userMenu.logout', 'Sign Out')}</span>
            </Button>
          </form>
        </div>
      )}
    </div>
  )
}
