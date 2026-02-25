'use client'
import * as React from 'react'
import Link from 'next/link'
import { User, LogOut, Bell, Moon, Sun, Globe, Key, Check } from 'lucide-react'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { locales, type Locale } from '@open-mercato/shared/lib/i18n/config'
import { useTheme } from '@open-mercato/ui/theme'
import { Button } from '../primitives/button'
import { IconButton } from '../primitives/icon-button'
import { useInjectedMenuItems } from './injection/useInjectedMenuItems'
import { mergeMenuItems, type MergedMenuItem } from './injection/mergeMenuItems'

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

  const menuItemClass =
    'w-full text-left text-sm cursor-pointer px-3 py-2 rounded hover:bg-accent inline-flex items-center gap-2.5 outline-none focus-visible:ring-1 focus-visible:ring-ring'

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

  const renderInjectedItem = React.useCallback(
    (item: MergedMenuItem) => {
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
            <span>{item.labelKey ? t(item.labelKey, item.label ?? item.id) : (item.label ?? item.id)}</span>
          </Link>
        )
      }
      return (
        <Button
          key={item.id}
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          role="menuitem"
          data-menu-item-id={item.id}
          onClick={() => {
            item.onClick?.()
            setOpen(false)
          }}
        >
          <span>{item.labelKey ? t(item.labelKey, item.label ?? item.id) : (item.label ?? item.id)}</span>
        </Button>
      )
    },
    [menuItemClass, t],
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
            <Key className="size-4" />
            <span>{t('ui.profileMenu.changePassword', 'Change Password')}</span>
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
            <Bell className="size-4" />
            <span>{t('ui.profileMenu.notifications', 'Notification Preferences')}</span>
          </Link>
        )
      }

      if (id === 'theme-toggle') {
        return mounted ? (
          <Button
            key={id}
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
        ) : null
      }

      if (id === 'language') {
        return (
          <div key={id} className="relative">
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
        )
      }

      if (id === 'sign-out') {
        return (
          <form key={id} action="/api/auth/logout" method="POST">
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
          className="absolute right-0 top-full mt-1 w-56 rounded-md border bg-background p-1 shadow-lg z-50"
          role="menu"
          data-testid="profile-dropdown"
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

          {mergedMenuItems.map((item) => (
            <React.Fragment key={item.id}>
              {item.separator ? <div className="my-1 border-t" /> : null}
              {item.source === 'injected' ? renderInjectedItem(item) : renderBuiltInItem(item.id)}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  )
}
