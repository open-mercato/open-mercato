'use client'
import * as React from 'react'
import Link from 'next/link'
import { User, LogOut, Settings, Bell, Moon, Sun, Globe, UserCircle } from 'lucide-react'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { locales, type Locale } from '@open-mercato/shared/lib/i18n/config'
import { useTheme } from '@open-mercato/ui/theme'

export type ProfileMenuItem = {
  href: string
  title: string
  icon?: React.ReactNode
}

export type ProfileDropdownProps = {
  email?: string
  profileItems?: ProfileMenuItem[]
  settingsHref?: string
  profileHref?: string
  notificationsHref?: string
  showThemeToggle?: boolean
  showLanguageSelector?: boolean
}

const localeLabels: Record<Locale, string> = {
  en: 'English',
  de: 'Deutsch',
  es: 'Espanol',
  pl: 'Polski',
}

export function ProfileDropdown({
  email,
  profileItems = [],
  settingsHref = '/backend/settings',
  profileHref,
  notificationsHref,
  showThemeToggle = true,
  showLanguageSelector = true,
}: ProfileDropdownProps) {
  const t = useT()
  const currentLocale = useLocale()
  const { resolvedTheme, setTheme } = useTheme()
  const [open, setOpen] = React.useState(false)
  const [mounted, setMounted] = React.useState(false)
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)
  const firstItemRef = React.useRef<HTMLAnchorElement | HTMLButtonElement>(null)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  const isDark = resolvedTheme === 'dark'

  const onMouseEnter = () => setOpen(true)
  const onMouseLeave = () => setOpen(false)

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
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  React.useEffect(() => {
    if (!open) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open])

  React.useEffect(() => {
    if (open) {
      setTimeout(() => {
        firstItemRef.current?.focus()
      }, 0)
    }
  }, [open])

  const handleEscapeKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false)
      buttonRef.current?.focus()
    }
  }

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

  const hasProfileItems = profileItems.length > 0

  const menuItemClass =
    'w-full text-left text-sm px-2 py-1.5 rounded hover:bg-accent inline-flex items-center gap-2 outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 focus-visible:ring-0'

  return (
    <div className="relative" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <button
        ref={buttonRef}
        className="text-sm px-2 py-1 rounded hover:bg-accent inline-flex items-center gap-2"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls="profile-menu-dropdown"
        id="profile-menu-button"
        type="button"
        title={email || t('ui.userMenu.userFallback', 'User')}
      >
        <User className="size-4" />
      </button>
      {open && (
        <div
          ref={menuRef}
          id="profile-menu-dropdown"
          className="absolute right-0 top-full mt-0 w-56 rounded-md border bg-background p-1 shadow z-50"
          role="menu"
          aria-labelledby="profile-menu-button"
          tabIndex={-1}
        >
          {email && (
            <div className="px-2 py-2 text-xs text-muted-foreground border-b mb-1">
              <div className="font-medium">{t('ui.userMenu.loggedInAs', 'Logged in as:')}</div>
              <div className="truncate">{email}</div>
            </div>
          )}

          {profileHref && (
            <Link
              ref={firstItemRef as React.RefObject<HTMLAnchorElement>}
              href={profileHref}
              className={menuItemClass}
              role="menuitem"
              tabIndex={0}
              onClick={() => setOpen(false)}
              onKeyDown={handleEscapeKey}
            >
              <UserCircle className="size-4" />
              <span>{t('ui.profileMenu.profile', 'My Profile')}</span>
            </Link>
          )}

          <Link
            ref={!profileHref ? firstItemRef as React.RefObject<HTMLAnchorElement> : undefined}
            href={settingsHref}
            className={menuItemClass}
            role="menuitem"
            tabIndex={0}
            onClick={() => setOpen(false)}
            onKeyDown={handleEscapeKey}
          >
            <Settings className="size-4" />
            <span>{t('ui.profileMenu.settings', 'Settings')}</span>
          </Link>

          {notificationsHref && (
            <Link
              href={notificationsHref}
              className={menuItemClass}
              role="menuitem"
              tabIndex={0}
              onClick={() => setOpen(false)}
              onKeyDown={handleEscapeKey}
            >
              <Bell className="size-4" />
              <span>{t('ui.profileMenu.notifications', 'Notification Preferences')}</span>
            </Link>
          )}

          {hasProfileItems && (
            <>
              <div className="my-1 border-t" />
              {profileItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={menuItemClass}
                  role="menuitem"
                  tabIndex={0}
                  onClick={() => setOpen(false)}
                  onKeyDown={handleEscapeKey}
                >
                  {item.icon && <span className="size-4">{item.icon}</span>}
                  <span>{item.title}</span>
                </Link>
              ))}
            </>
          )}

          {(showThemeToggle || showLanguageSelector) && <div className="my-1 border-t" />}

          {showThemeToggle && mounted && (
            <button
              type="button"
              className={`${menuItemClass} justify-between`}
              role="menuitem"
              tabIndex={0}
              onClick={handleThemeToggle}
              onKeyDown={handleEscapeKey}
            >
              <span className="inline-flex items-center gap-2">
                {isDark ? <Moon className="size-4" /> : <Sun className="size-4" />}
                <span>{t('ui.profileMenu.theme', 'Theme')}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {isDark
                  ? t('ui.profileMenu.theme.dark', 'Dark')
                  : t('ui.profileMenu.theme.light', 'Light')}
              </span>
            </button>
          )}

          {showLanguageSelector && (
            <div className="relative group/lang">
              <button
                type="button"
                className={`${menuItemClass} justify-between`}
                role="menuitem"
                tabIndex={0}
                onKeyDown={handleEscapeKey}
              >
                <span className="inline-flex items-center gap-2">
                  <Globe className="size-4" />
                  <span>{t('ui.profileMenu.language', 'Language')}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {localeLabels[currentLocale]}
                </span>
              </button>
              <div className="absolute left-full top-0 ml-1 hidden group-hover/lang:block">
                <div className="rounded-md border bg-background p-1 shadow min-w-[120px]">
                  {locales.map((locale) => (
                    <button
                      key={locale}
                      type="button"
                      className={`${menuItemClass} ${locale === currentLocale ? 'bg-accent' : ''}`}
                      onClick={() => handleLocaleChange(locale)}
                    >
                      {localeLabels[locale]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="my-1 border-t" />
          <form action="/api/auth/logout" method="POST">
            <button
              className={menuItemClass}
              type="submit"
              role="menuitem"
              tabIndex={0}
              onKeyDown={handleEscapeKey}
            >
              <LogOut className="size-4" />
              <span>{t('ui.userMenu.logout', 'Logout')}</span>
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
