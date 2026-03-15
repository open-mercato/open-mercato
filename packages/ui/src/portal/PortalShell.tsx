"use client"
import { type ReactNode, useState, useCallback, useMemo } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '../primitives/button'
import { IconButton } from '../primitives/icon-button'
import { usePortalInjectedMenuItems } from './hooks/usePortalInjectedMenuItems'
import { usePortalEventBridge } from './hooks/usePortalEventBridge'
import { mergeMenuItems } from '../backend/injection/mergeMenuItems'
import type { MergedMenuItem } from '../backend/injection/mergeMenuItems'
import { PortalNotificationBell } from './components/PortalNotificationBell'

// Component replacement handle IDs (FROZEN once shipped)
export const PORTAL_SHELL_HANDLE = 'page:portal:layout'
export const PORTAL_HEADER_HANDLE = 'section:portal:header'
export const PORTAL_FOOTER_HANDLE = 'section:portal:footer'
export const PORTAL_SIDEBAR_HANDLE = 'section:portal:sidebar'
export const PORTAL_USER_MENU_HANDLE = 'section:portal:user-menu'

export type PortalShellProps = {
  children: ReactNode
  orgSlug?: string
  organizationName?: string
  authenticated?: boolean
  onLogout?: () => void
  enableEventBridge?: boolean
  userName?: string
  userEmail?: string
}

function PortalEventBridgeMount() {
  usePortalEventBridge()
  return null
}

/* ---- Inline SVG icons (avoid lucide-react dep) ---- */

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="4" x2="20" y1="12" y2="12" /><line x1="4" x2="20" y1="6" y2="6" /><line x1="4" x2="20" y1="18" y2="18" />
    </svg>
  )
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 6 6 18" /><path d="m6 6 12 12" />
    </svg>
  )
}

function LogOutIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" x2="9" y1="12" y2="12" />
    </svg>
  )
}

/* ---- Sidebar nav item ---- */

function SidebarNavItem({
  item,
  active,
  t,
  onClick,
}: {
  item: MergedMenuItem
  active: boolean
  t: (key: string, fallback?: string) => string
  onClick?: () => void
}) {
  const label = item.labelKey ? t(item.labelKey, item.label) : item.label
  if (!label) return null

  const cls = [
    'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
    active
      ? 'bg-foreground text-background'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
  ].join(' ')

  if (item.href) {
    return (
      <Link href={item.href} className={cls} data-menu-item-id={item.id} onClick={onClick}>
        {label}
      </Link>
    )
  }
  if (item.onClick) {
    return (
      <button type="button" className={cls} data-menu-item-id={item.id} onClick={() => { item.onClick?.(); onClick?.() }}>
        {label}
      </button>
    )
  }
  return null
}

/* ---- User initials avatar ---- */

function UserAvatar({ name, className }: { name?: string; className?: string }) {
  const initials = name
    ? name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
    : '?'
  return (
    <div className={`flex items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-background ${className ?? 'size-8'}`}>
      {initials}
    </div>
  )
}

/* ================================================================== */
/*  PortalShell                                                       */
/* ================================================================== */

export function PortalShell({
  children,
  orgSlug,
  organizationName,
  authenticated,
  onLogout,
  enableEventBridge = false,
  userName,
  userEmail,
}: PortalShellProps) {
  const t = useT()
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  const { items: injectedMainItems } = usePortalInjectedMenuItems('menu:portal:sidebar:main')
  const { items: injectedAccountItems } = usePortalInjectedMenuItems('menu:portal:sidebar:account')

  const portalHome = orgSlug ? `/${orgSlug}/portal` : '/portal'
  const loginHref = orgSlug ? `/${orgSlug}/portal/login` : '/portal/login'
  const signupHref = orgSlug ? `/${orgSlug}/portal/signup` : '/portal/signup'
  const dashboardHref = orgSlug ? `/${orgSlug}/portal/dashboard` : '/portal/dashboard'
  const headerTitle = organizationName || t('portal.title', 'Customer Portal')

  const closeMobile = useCallback(() => setMobileOpen(false), [])

  const profileHref = orgSlug ? `/${orgSlug}/portal/profile` : '/portal/profile'

  const mergedNavItems = useMemo(() => {
    if (!authenticated) return []
    const builtIn = [
      { id: 'portal-dashboard', labelKey: 'portal.nav.dashboard', href: dashboardHref },
    ]
    return mergeMenuItems(builtIn, injectedMainItems)
  }, [authenticated, dashboardHref, injectedMainItems])

  const mergedAccountItems = useMemo(() => {
    if (!authenticated) return []
    const builtIn = [
      { id: 'portal-profile', labelKey: 'portal.nav.profile', href: profileHref },
    ]
    return mergeMenuItems(builtIn, injectedAccountItems)
  }, [authenticated, profileHref, injectedAccountItems])

  /* ---- PUBLIC LAYOUT ---- */
  if (!authenticated) {
    return (
      <div className="flex min-h-svh flex-col bg-background" data-portal-handle={PORTAL_SHELL_HANDLE}>
        {/* Sticky header matching landing page nav style */}
        <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80" data-portal-handle={PORTAL_HEADER_HANDLE}>
          <div className="mx-auto flex h-16 w-full max-w-screen-lg items-center justify-between px-6">
            <Link href={portalHome} className="flex items-center gap-2.5 text-foreground transition hover:opacity-80" aria-label={headerTitle}>
              <Image src="/open-mercato.svg" alt="" width={28} height={28} className="dark:invert" priority />
              <span className="text-[15px] font-semibold tracking-tight">{headerTitle}</span>
            </Link>
            <nav aria-label="Primary" className="flex items-center gap-1">
              <Button asChild variant="ghost" size="sm" className="text-[13px]">
                <Link href={loginHref}>{t('portal.nav.login', 'Log In')}</Link>
              </Button>
              <Button asChild size="sm" className="rounded-lg text-[13px]">
                <Link href={signupHref}>{t('portal.nav.signup', 'Sign Up')}</Link>
              </Button>
            </nav>
          </div>
        </header>

        <main className="flex-1">
          <div className="mx-auto flex w-full max-w-screen-lg flex-col gap-8 px-6 py-12 sm:py-20">
            {children}
          </div>
        </main>

        <footer className="border-t" data-portal-handle={PORTAL_FOOTER_HANDLE}>
          <div className="mx-auto flex w-full max-w-screen-lg items-center justify-between px-6 py-6">
            <Link href={portalHome} className="flex items-center gap-2 text-muted-foreground transition hover:text-foreground">
              <Image src="/open-mercato.svg" alt="" width={20} height={20} className="dark:invert" />
              <span className="text-sm font-medium text-foreground">{headerTitle}</span>
            </Link>
            <p className="text-xs text-muted-foreground/60">
              {t('portal.footer.copyright', `\u00A9 ${new Date().getFullYear()} All rights reserved.`)}
            </p>
          </div>
        </footer>
      </div>
    )
  }

  /* ---- AUTHENTICATED LAYOUT ---- */

  const sidebarContent = (
    <div className="flex h-full flex-col" data-portal-handle={PORTAL_SIDEBAR_HANDLE}>
      {/* Logo */}
      <div className="flex h-16 items-center gap-2.5 border-b px-5">
        <Link href={portalHome} className="flex items-center gap-2.5 text-foreground transition hover:opacity-80" aria-label={headerTitle}>
          <Image src="/open-mercato.svg" alt="" width={22} height={22} className="dark:invert" />
          <span className="text-[14px] font-semibold tracking-tight truncate">{headerTitle}</span>
        </Link>
      </div>

      {/* Navigation */}
      <nav aria-label="Portal navigation" className="flex-1 overflow-y-auto px-3 py-5">
        {/* Section label */}
        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/50">
          {t('portal.nav.home', 'Portal')}
        </p>
        <div className="flex flex-col gap-0.5">
          {mergedNavItems.map((item) => (
            <SidebarNavItem
              key={item.id}
              item={item}
              active={!!item.href && pathname.startsWith(item.href)}
              t={t}
              onClick={closeMobile}
            />
          ))}
        </div>

        {/* Account section (injected) */}
        {mergedAccountItems.length > 0 ? (
          <div className="mt-8">
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/50">
              {t('portal.nav.account', 'Account')}
            </p>
            <div className="flex flex-col gap-0.5">
              {mergedAccountItems.map((item) => (
                <SidebarNavItem
                  key={item.id}
                  item={item}
                  active={!!item.href && pathname.startsWith(item.href)}
                  t={t}
                  onClick={closeMobile}
                />
              ))}
            </div>
          </div>
        ) : null}
      </nav>

      {/* User section */}
      <div className="border-t px-3 py-3">
        <div className="flex items-center gap-2.5 rounded-lg px-3 py-2">
          <UserAvatar name={userName} className="size-8" />
          <div className="min-w-0 flex-1">
            {userName ? <p className="truncate text-[13px] font-medium leading-tight">{userName}</p> : null}
            {userEmail ? <p className="truncate text-[11px] text-muted-foreground">{userEmail}</p> : null}
          </div>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="mt-0.5 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          data-portal-handle={PORTAL_USER_MENU_HANDLE}
          data-menu-item-id="portal-logout"
        >
          <LogOutIcon className="size-4" />
          {t('portal.nav.logout', 'Log Out')}
        </button>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-svh bg-background" data-portal-handle={PORTAL_SHELL_HANDLE}>
      {enableEventBridge ? <PortalEventBridgeMount /> : null}

      {/* Desktop sidebar */}
      <aside className="hidden w-[240px] shrink-0 border-r lg:block">
        {sidebarContent}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={closeMobile} />
          <aside className="relative z-10 h-full w-[280px] bg-background shadow-2xl">
            <div className="absolute right-3 top-4 z-20">
              <IconButton variant="ghost" size="sm" type="button" onClick={closeMobile} aria-label="Close menu">
                <XIcon className="size-4" />
              </IconButton>
            </div>
            {sidebarContent}
          </aside>
        </div>
      ) : null}

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top header */}
        <header className="flex h-16 items-center justify-between border-b px-4 lg:px-8" data-portal-handle={PORTAL_HEADER_HANDLE}>
          <div className="flex items-center gap-3">
            <IconButton variant="ghost" size="sm" type="button" onClick={() => setMobileOpen(true)} className="lg:hidden" aria-label="Open menu">
              <MenuIcon className="size-5" />
            </IconButton>
          </div>
          <div className="flex items-center gap-3">
            <PortalNotificationBell t={t} />
            {userName ? (
              <span className="hidden text-[13px] text-muted-foreground sm:inline">{userName}</span>
            ) : null}
            <UserAvatar name={userName} className="size-7 text-[10px]" />
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="w-full px-4 py-6 lg:px-8 lg:py-8">
            {children}
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t px-4 py-4 lg:px-8" data-portal-handle={PORTAL_FOOTER_HANDLE}>
          <p className="text-[11px] text-muted-foreground/50">
            {t('portal.footer.copyright', `\u00A9 ${new Date().getFullYear()} All rights reserved.`)}
          </p>
        </footer>
      </div>
    </div>
  )
}

export default PortalShell
