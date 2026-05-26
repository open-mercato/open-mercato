'use client'
import * as React from 'react'
import Link from 'next/link'
import { User, LogOut, Bell, Moon, Sun, Globe, Key, Check, ChevronRight } from 'lucide-react'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { locales, type Locale } from '@open-mercato/shared/lib/i18n/config'
import { useTheme } from '@open-mercato/ui/theme'
import { cn } from '@open-mercato/shared/lib/utils'
import { IconButton } from '../primitives/icon-button'
import { Switch } from '../primitives/switch'
import { useInjectedMenuItems } from './injection/useInjectedMenuItems'
import { mergeMenuItems, type MergedMenuItem } from './injection/mergeMenuItems'
import { resolveInjectedIcon } from './injection/resolveInjectedIcon'
import { InjectionSpot } from './injection/InjectionSpot'
import { BACKEND_TOPBAR_PROFILE_MENU_INJECTION_SPOT_ID } from './injection/spotIds'

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
  const { items: injectedItems } = useInjectedMenuItems('menu:topbar:profile-dropdown')

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

  // Unified row class — every menu item uses this for perfectly aligned layout.
  // h-9 keeps all rows the same height regardless of whether they have a trailing element.
  const menuItemClass = cn(
    'group flex h-9 w-full items-center gap-3 rounded-md px-2.5 text-sm text-foreground',
    'transition-colors hover:bg-muted/60 focus:outline-none focus-visible:bg-muted/60',
    'cursor-pointer',
  )
  const menuIconClass = 'size-4 shrink-0 text-muted-foreground group-hover:text-foreground'

  const resolveMenuLabel = React.useCallback(
    (item: Pick<MergedMenuItem, 'id' | 'label' | 'labelKey'>): string => {
      if (item.labelKey && item.label) return t(item.labelKey, item.label)
      if (item.labelKey) return t(item.labelKey, item.id)
      if (item.label && item.label.includes('.')) return t(item.label, item.id)
      return item.label ?? item.id
    },
    [t],
  )

  const builtInMenuItems = React.useMemo(
    () => {
      const items: Array<{ id: string; separator?: boolean }> = [{ id: 'change-password' }]
      if (notificationsHref) items.push({ id: 'notifications' })
      items.push({ id: 'theme-toggle', separator: true }, { id: 'language' }, { id: 'sign-out', separator: true })
      return items
    },
    [notificationsHref],
  )

  const mergedMenuItems = React.useMemo(
    () => mergeMenuItems(builtInMenuItems, injectedItems),
    [builtInMenuItems, injectedItems],
  )
  const injectionContext = React.useMemo(
    () => ({
      email,
      displayName,
      locale: currentLocale,
    }),
    [currentLocale, displayName, email],
  )

  const renderInjectedItem = React.useCallback(
    (item: MergedMenuItem) => {
      const label = resolveMenuLabel(item)
      const icon = resolveInjectedIcon(item.icon)
      const inner = (
        <>
          <span className={menuIconClass}>{icon}</span>
          <span className="flex-1 truncate">{label}</span>
        </>
      )
      if (item.href) {
        return (
          <Link
            key={item.id}
            href={item.href}
            className={menuItemClass}
            role="menuitem"
            data-menu-item-id={item.id}
            onClick={() => setOpen(false)}
          >
            {inner}
          </Link>
        )
      }
      return (
        <button
          key={item.id}
          type="button"
          className={menuItemClass}
          role="menuitem"
          data-menu-item-id={item.id}
          onClick={() => {
            item.onClick?.()
            setOpen(false)
          }}
        >
          {inner}
        </button>
      )
    },
    [menuItemClass, menuIconClass, resolveMenuLabel],
  )

  const renderBuiltInItem = React.useCallback(
    (id: string) => {
      if (id === 'change-password') {
        return (
          <Link
            key={id}
            href={changePasswordHref}
            className={menuItemClass}
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            <Key className={menuIconClass} />
            <span className="flex-1 truncate">{t('ui.profileMenu.changePassword', 'Change Password')}</span>
          </Link>
        )
      }

      if (id === 'notifications' && notificationsHref) {
        return (
          <Link
            key={id}
            href={notificationsHref}
            className={menuItemClass}
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            <Bell className={menuIconClass} />
            <span className="flex-1 truncate">{t('ui.profileMenu.notifications', 'Notification Preferences')}</span>
          </Link>
        )
      }

      if (id === 'theme-toggle') {
        if (!mounted) return null
        return (
          <div
            key={id}
            className={cn(menuItemClass, 'justify-between')}
            role="menuitem"
            onClick={handleThemeToggle}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                handleThemeToggle()
              }
            }}
            tabIndex={0}
          >
            <span className="flex flex-1 items-center gap-3">
              {isDark ? <Moon className={menuIconClass} /> : <Sun className={menuIconClass} />}
              <span className="flex-1 truncate">{t('ui.profileMenu.theme', 'Theme')}</span>
            </span>
            <Switch
              checked={isDark}
              onCheckedChange={handleThemeToggle}
              aria-label={t('ui.profileMenu.theme', 'Theme')}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )
      }

      if (id === 'language') {
        return (
          <div key={id} className="contents">
            <button
              type="button"
              className={menuItemClass}
              role="menuitem"
              onClick={() => setLanguageOpen(!languageOpen)}
              aria-expanded={languageOpen}
            >
              <Globe className={menuIconClass} />
              <span className="truncate">{t('ui.profileMenu.language', 'Language')}</span>
              <span className="text-xs text-muted-foreground">{localeLabels[currentLocale]}</span>
              <ChevronRight
                className={cn(
                  'ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform',
                  languageOpen && 'rotate-90',
                )}
                aria-hidden="true"
              />
            </button>
            {languageOpen && (
              <div className="ml-7 mr-1 flex flex-col gap-0.5 border-l pl-2 py-1">
                {locales.map((locale) => (
                  <button
                    key={locale}
                    type="button"
                    className={cn(
                      'flex h-8 w-full items-center justify-between gap-2 rounded-md px-2 text-sm transition-colors hover:bg-muted/60 focus:outline-none focus-visible:bg-muted/60',
                      locale === currentLocale ? 'font-medium text-foreground' : 'text-muted-foreground',
                    )}
                    onClick={() => handleLocaleChange(locale)}
                  >
                    <span className="truncate">{localeLabels[locale]}</span>
                    {locale === currentLocale && <Check className="size-3.5 shrink-0 text-accent-indigo" aria-hidden="true" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      }

      if (id === 'sign-out') {
        return (
          <form key={id} action="/api/auth/logout" method="POST">
            <button
              type="submit"
              className={menuItemClass}
              role="menuitem"
            >
              <LogOut className={menuIconClass} />
              <span className="flex-1 truncate text-left">{t('ui.userMenu.logout', 'Sign Out')}</span>
            </button>
          </form>
        )
      }

      return null
    },
    [
      changePasswordHref,
      currentLocale,
      handleThemeToggle,
      isDark,
      languageOpen,
      menuItemClass,
      menuIconClass,
      mounted,
      notificationsHref,
      t,
    ],
  )

  return (
    <div className="relative">
      <IconButton
        ref={buttonRef}
        variant="ghost"
        size="sm"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid="profile-dropdown-trigger"
        title={email || t('ui.userMenu.userFallback', 'User')}
      >
        <User className="size-4" />
      </IconButton>

      {open && (
        <div
          ref={menuRef}
          className="absolute right-0 top-full z-popover mt-2 w-64 overflow-hidden rounded-lg border bg-popover p-0 shadow-lg"
          role="menu"
          data-testid="profile-dropdown"
        >
          {/* User info header */}
          {(displayName || email) && (
            <div className="flex items-center gap-3 border-b bg-muted/30 px-3 py-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-indigo/10 text-accent-indigo">
                <User className="size-4" aria-hidden="true" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                {displayName ? (
                  <span className="truncate text-sm font-medium leading-5 text-foreground">{displayName}</span>
                ) : null}
                {email ? (
                  <span className={cn(
                    'truncate text-xs leading-4',
                    displayName ? 'text-muted-foreground' : 'text-foreground font-medium',
                  )}>
                    {email}
                  </span>
                ) : null}
                {!displayName && email ? (
                  <span className="truncate text-overline uppercase tracking-wider text-muted-foreground/80">
                    {t('ui.userMenu.loggedInAs', 'Logged in')}
                  </span>
                ) : null}
              </div>
            </div>
          )}

          <div className="flex flex-col p-1.5">
            {mergedMenuItems.map((item) => (
              <React.Fragment key={item.id}>
                {item.separator ? <div className="my-1 h-px bg-border" aria-hidden="true" /> : null}
                {item.source === 'injected'
                  ? (item.href || item.onClick || item.label || item.labelKey ? renderInjectedItem(item) : null)
                  : renderBuiltInItem(item.id)}
              </React.Fragment>
            ))}
            <InjectionSpot
              spotId={BACKEND_TOPBAR_PROFILE_MENU_INJECTION_SPOT_ID}
              context={injectionContext}
            />
          </div>
        </div>
      )}
    </div>
  )
}
