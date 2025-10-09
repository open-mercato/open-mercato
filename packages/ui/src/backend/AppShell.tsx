"use client"
import * as React from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Separator } from '../primitives/separator'
import { FlashMessages } from './FlashMessages'
import { usePathname } from 'next/navigation'
import { apiFetch } from './utils/api'

export type AppShellProps = {
  productName?: string
  email?: string
  groups: { name: string; items: { href: string; title: string; icon?: React.ReactNode; enabled?: boolean; children?: { href: string; title: string; icon?: React.ReactNode; enabled?: boolean }[] }[] }[]
  children: React.ReactNode
  rightHeaderSlot?: React.ReactNode
  sidebarCollapsedDefault?: boolean
  currentTitle?: string
  breadcrumb?: Array<{ label: string; href?: string }>
  // Optional: full admin nav API to refresh sidebar client-side
  adminNavApi?: string
}

type Breadcrumb = Array<{ label: string; href?: string }>

const HeaderContext = React.createContext<{
  setBreadcrumb: (b?: Breadcrumb) => void
  setTitle: (t?: string) => void
} | null>(null)

export function ApplyBreadcrumb({ breadcrumb, title }: { breadcrumb?: Breadcrumb; title?: string }) {
  const ctx = React.useContext(HeaderContext)
  React.useEffect(() => {
    ctx?.setBreadcrumb(breadcrumb)
    if (title !== undefined) ctx?.setTitle(title)
  }, [ctx, breadcrumb, title])
  return null
}

const DefaultIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M8 6h13M8 12h13M8 18h13"/>
    <path d="M3 6h.01M3 12h.01M3 18h.01"/>
  </svg>
)

// DataTable icon used for dynamic custom entity records links
const DataTableIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="4" width="18" height="16" rx="2" ry="2"/>
    <line x1="3" y1="8" x2="21" y2="8"/>
    <line x1="9" y1="8" x2="9" y2="20"/>
    <line x1="15" y1="8" x2="15" y2="20"/>
  </svg>
)

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`transition-transform ${open ? 'rotate-180' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
  )
}

export function AppShell({ productName = 'Admin', email, groups, rightHeaderSlot, children, sidebarCollapsedDefault = false, currentTitle, breadcrumb, adminNavApi }: AppShellProps) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = React.useState(false)
  // Initialize from server-provided prop only to avoid hydration flicker
  const [collapsed, setCollapsed] = React.useState<boolean>(sidebarCollapsedDefault)
  // Maintain internal nav state so we can augment it client-side
  const [navGroups, setNavGroups] = React.useState(AppShell.cloneGroups(groups))
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>(() => {
    const base = Object.fromEntries(groups.map(g => [g.name, true])) as Record<string, boolean>
    if (typeof window === 'undefined') return base
    try {
      const savedOpen = localStorage.getItem('om:sidebarOpenGroups')
      if (savedOpen) {
        const parsed = JSON.parse(savedOpen) as Record<string, boolean>
        for (const k of Object.keys(base)) if (k in parsed) base[k] = !!parsed[k]
      }
    } catch {}
    return base
  })
  const [headerTitle, setHeaderTitle] = React.useState<string | undefined>(currentTitle)
  const [headerBreadcrumb, setHeaderBreadcrumb] = React.useState<Breadcrumb | undefined>(breadcrumb)

  const toggleGroup = (name: string) => setOpenGroups((prev) => ({ ...prev, [name]: !prev[name] }))

  const asideWidth = collapsed ? '72px' : '240px'
  // Use min-h-svh so the border extends with tall content; keep overflow for long menus
  const asideClassesBase = `border-r bg-background/60 py-4 min-h-svh overflow-y-auto`;

  // Persist collapse state to localStorage and cookie
  React.useEffect(() => {
    try { localStorage.setItem('om:sidebarCollapsed', collapsed ? '1' : '0') } catch {}
    try {
      document.cookie = `om_sidebar_collapsed=${collapsed ? '1' : '0'}; path=/; max-age=31536000; samesite=lax`
    } catch {}
  }, [collapsed])
  React.useEffect(() => {
    try { localStorage.setItem('om:sidebarOpenGroups', JSON.stringify(openGroups)) } catch {}
  }, [openGroups])

  // Ensure current route's group is expanded on load
  React.useEffect(() => {
    const activeGroup = navGroups.find((g) => g.items.some((i) => pathname?.startsWith(i.href)))?.name
    if (!activeGroup) return
    setOpenGroups((prev) => (prev[activeGroup] === false ? { ...prev, [activeGroup]: true } : prev))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, navGroups])
  // Keep header state in sync with props (server-side updates)
  React.useEffect(() => {
    setHeaderTitle(currentTitle)
    setHeaderBreadcrumb(breadcrumb)
  }, [currentTitle, breadcrumb])

  // Keep navGroups in sync when server-provided groups change
  React.useEffect(() => {
    setNavGroups(AppShell.cloneGroups(groups))
  }, [groups])

  // Optional: full refresh from adminNavApi, used to reflect RBAC/org/entity changes without page reload
  React.useEffect(() => {
    let cancelled = false
    function indexIcons(groupsToIndex: AppShellProps['groups']): Map<string, React.ReactNode | undefined> {
      const map = new Map<string, React.ReactNode | undefined>()
      for (const g of groupsToIndex) {
        for (const i of g.items) {
          map.set(i.href, i.icon)
          if (i.children) for (const c of i.children) map.set(c.href, c.icon)
        }
      }
      return map
    }
    function mergePreservingIcons(oldG: AppShellProps['groups'], newG: AppShellProps['groups']): AppShellProps['groups'] {
      const iconMap = indexIcons(oldG)
      const merged = newG.map((g) => ({
        name: g.name,
        items: g.items.map((i) => ({
          href: i.href,
          title: i.title,
          enabled: i.enabled,
          icon: i.icon ?? iconMap.get(i.href),
          children: i.children?.map((c) => ({
            href: c.href,
            title: c.title,
            enabled: c.enabled,
            icon: c.icon ?? iconMap.get(c.href),
          })),
        })),
      }))
      return merged
    }
    async function refreshFullNav() {
      if (!adminNavApi) return
      try {
        const res = await apiFetch(adminNavApi, { credentials: 'include' as any })
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        const nextGroups = Array.isArray(data?.groups) ? data.groups : []
        if (nextGroups.length) setNavGroups((prev) => AppShell.cloneGroups(mergePreservingIcons(prev, nextGroups as any)))
      } catch {}
    }
    // Refresh on window focus
    refreshFullNav()
    const onFocus = () => refreshFullNav()
    window.addEventListener('focus', onFocus)
    return () => { cancelled = true; window.removeEventListener('focus', onFocus) }
  }, [adminNavApi])

  // Refresh sidebar when other parts of the app dispatch an explicit event
  React.useEffect(() => {
    if (!adminNavApi) return
    const api = adminNavApi as string
    let cancelled = false
    function indexIcons(groupsToIndex: AppShellProps['groups']): Map<string, React.ReactNode | undefined> {
      const map = new Map<string, React.ReactNode | undefined>()
      for (const g of groupsToIndex) {
        for (const i of g.items) {
          map.set(i.href, i.icon)
          if (i.children) for (const c of i.children) map.set(c.href, c.icon)
        }
      }
      return map
    }
    function mergePreservingIcons(oldG: AppShellProps['groups'], newG: AppShellProps['groups']): AppShellProps['groups'] {
      const iconMap = indexIcons(oldG)
      const merged = newG.map((g) => ({
        name: g.name,
        items: g.items.map((i) => ({
          href: i.href,
          title: i.title,
          enabled: i.enabled,
          icon: i.icon ?? iconMap.get(i.href),
          children: i.children?.map((c) => ({
            href: c.href,
            title: c.title,
            enabled: c.enabled,
            icon: c.icon ?? iconMap.get(c.href),
          })),
        })),
      }))
      return merged
    }
    async function refreshFullNav() {
      try {
        const res = await apiFetch(api, { credentials: 'include' as any })
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        const nextGroups = Array.isArray(data?.groups) ? data.groups : []
        if (nextGroups.length) setNavGroups((prev) => AppShell.cloneGroups(mergePreservingIcons(prev, nextGroups as any)))
      } catch {}
    }
    const onRefresh = () => { refreshFullNav() }
    window.addEventListener('om:refresh-sidebar', onRefresh as any)
    return () => { cancelled = true; window.removeEventListener('om:refresh-sidebar', onRefresh as any) }
  }, [adminNavApi])

  // adminNavApi already includes user entities; no extra fetch

  function renderSidebar(compact: boolean, showCollapseToggle: boolean, hideHeader?: boolean) {
    return (
      <div className="flex flex-col gap-2 min-h-full">
        {!hideHeader && (
          <div className={`flex items-center ${compact ? 'justify-center' : 'justify-between'} mb-2`}>
            <Link href="/backend" className="flex items-center gap-2" aria-label="Go to dashboard">
              <Image src="/open-mercato.svg" alt="Open Mercato" width={48} height={48} className="rounded" />
              {!compact && <div className="text-sm font-semibold">{productName}</div>}
            </Link>
          </div>
        )}
        <nav className="flex flex-col gap-2">
          {navGroups.map((g, gi) => {
            const open = openGroups[g.name] !== false
            return (
              <div key={g.name} className="">
                <button
                  type="button"
                  onClick={() => toggleGroup(g.name)}
                  className={`w-full ${compact ? 'px-0 justify-center' : 'px-2 justify-between'} flex items-center text-xs uppercase text-muted-foreground/90 py-2`}
                  aria-expanded={open}
                >
                  {!compact && <span>{g.name}</span>}
                  {!compact && <Chevron open={open} />}
                </button>
                {open && (
                  <div className={`flex flex-col ${compact ? 'items-center' : ''} gap-1 ${!compact ? 'pl-1' : ''}`}>
                    {g.items.map((i) => {
                      // Mark parent active when we're inside it BUT no visible child matches
                      const showChildren = !!pathname && pathname.startsWith(i.href)
                      const hasActiveChild = !!(i.children && pathname && i.children.some((c) => pathname.startsWith(c.href)))
                      const isParentActive = (pathname === i.href) || (showChildren && !hasActiveChild)
                      const base = compact ? 'w-10 h-10 justify-center' : 'px-2 py-1 gap-2'
                      return (
                        <React.Fragment key={i.href}>
                          <Link
                            href={i.href}
                            className={`relative text-sm rounded inline-flex items-center ${base} ${
                              isParentActive ? 'bg-background border shadow-sm' : 'hover:bg-accent hover:text-accent-foreground'
                            } ${i.enabled === false ? 'pointer-events-none opacity-50' : ''}`}
                            aria-disabled={i.enabled === false}
                            title={compact ? i.title : undefined}
                            onClick={() => setMobileOpen(false)}
                          >
                            {isParentActive ? (
                              <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded bg-foreground" />
                            ) : null}
                            <span className={`flex items-center justify-center shrink-0 ${compact ? '' : 'text-muted-foreground'}`}>
                              {i.icon ?? DefaultIcon}
                            </span>
                            {!compact && <span>{i.title}</span>}
                          </Link>
                          {/* Inline children when parent is active */}
                          {showChildren && i.children && i.children.length > 0 ? (
                            <div className={`flex flex-col ${compact ? 'items-center' : ''} gap-1 ${!compact ? 'pl-4' : ''}`}>
                              {i.children.map((c) => {
                                const childActive = pathname?.startsWith(c.href)
                                const childBase = compact ? 'w-10 h-8 justify-center' : 'px-2 py-1 gap-2'
                                return (
                                  <Link
                                    key={c.href}
                                    href={c.href}
                                    className={`relative text-sm rounded inline-flex items-center ${childBase} ${
                                      childActive ? 'bg-background border shadow-sm' : 'hover:bg-accent hover:text-accent-foreground'
                                    } ${c.enabled === false ? 'pointer-events-none opacity-50' : ''}`}
                                    aria-disabled={c.enabled === false}
                                    title={compact ? c.title : undefined}
                                    onClick={() => setMobileOpen(false)}
                                  >
                                    {childActive ? (
                                      <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded bg-foreground" />
                                    ) : null}
                                    <span className={`flex items-center justify-center shrink-0 ${compact ? '' : 'text-muted-foreground'}`}>
                                      {c.icon ?? (c.href.includes('/backend/entities/user/') && c.href.endsWith('/records') ? DataTableIcon : DefaultIcon)}
                                    </span>
                                    {!compact && <span>{c.title}</span>}
                                  </Link>
                                )
                              })}
                            </div>
                          ) : null}
                        </React.Fragment>
                      )
                    })}
                  </div>
                )}
                {gi < navGroups.length - 1 && <div className="my-2 border-t border-dotted" />}
              </div>
            )
          })}
        </nav>
      </div>
    )
  }

  const gridColsClass = collapsed ? 'lg:grid-cols-[72px_1fr]' : 'lg:grid-cols-[240px_1fr]'
  const headerCtxValue = React.useMemo(() => ({
    setBreadcrumb: setHeaderBreadcrumb,
    setTitle: setHeaderTitle,
  }), [])

  return (
    <HeaderContext.Provider value={headerCtxValue}>
    <div className={`min-h-svh lg:grid ${gridColsClass}`}>
      {/* Desktop sidebar */}
      <aside className={`${asideClassesBase} ${collapsed ? 'px-2' : 'px-3'} hidden lg:block`}>{renderSidebar(collapsed, true)}</aside>

      <div className="flex min-h-svh flex-col">
        <header className="border-b bg-background/60 px-3 lg:px-4 py-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Mobile menu button */}
            <button type="button" className="lg:hidden rounded border px-2 py-1" aria-label="Open menu" onClick={() => setMobileOpen(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
            </button>
            {/* Desktop collapse toggle */}
            <button type="button" className="hidden lg:inline-flex rounded border px-2 py-1" aria-label="Toggle sidebar" onClick={() => setCollapsed((c) => !c)}>
              {/* Sidebar toggle icon */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="16" rx="2"/>
                <path d="M9 4v16"/>
              </svg>
            </button>
            {/* Header breadcrumb: always starts with Dashboard */}
            {(() => {
              const root: Breadcrumb = [{ label: 'Dashboard', href: '/backend' }]
              let rest: Breadcrumb = []
              if (headerBreadcrumb && headerBreadcrumb.length) {
                const first = headerBreadcrumb[0]
                const dup = first && (first.href === '/backend' || first.label?.toLowerCase() === 'dashboard')
                rest = dup ? headerBreadcrumb.slice(1) : headerBreadcrumb
              } else if (headerTitle) {
                rest = [{ label: headerTitle }]
              }
              const items = [...root, ...rest]
              return (
                <nav className="flex items-center gap-2 text-sm">
                  {items.map((b, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && <span className="text-muted-foreground">/</span>}
                      {b.href ? (
                        <Link href={b.href} className="text-muted-foreground hover:text-foreground">
                          {b.label}
                        </Link>
                      ) : (
                        <span className="font-medium truncate max-w-[60vw]">{b.label}</span>
                      )}
                    </React.Fragment>
                  ))}
                </nav>
              )
            })()}
          </div>
          <div className="flex items-center gap-2 text-sm w-full lg:w-auto lg:justify-end">
            {rightHeaderSlot ? (
              rightHeaderSlot
            ) : (
              <>
                <Separator className="w-px h-5 mx-1" />
                <span className="opacity-80">{email || 'User'}</span>
              </>
            )}
          </div>
        </header>
        <main className="p-4 lg:p-6">
          <FlashMessages />
          {children}
        </main>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-[260px] bg-background border-r p-3">
            <div className="mb-2 flex items-center justify-between">
              <Link href="/backend" className="flex items-center gap-2 text-sm font-semibold" onClick={() => setMobileOpen(false)} aria-label="Go to dashboard">
                <Image src="/open-mercato.svg" alt="Open Mercato" width={28} height={28} className="rounded" />
                {productName}
              </Link>
              <button className="rounded border px-2 py-1" onClick={() => setMobileOpen(false)} aria-label="Close menu">✕</button>
            </div>
            {/* Force expanded sidebar in mobile drawer, hide its header and collapse toggle */}
            {renderSidebar(false, false, true)}
          </aside>
        </div>
      )}
    </div>
    </HeaderContext.Provider>
  )
}

// Helper: deep-clone minimal shape we mutate (children arrays)
AppShell.cloneGroups = function cloneGroups(groups: AppShellProps['groups']): AppShellProps['groups'] {
  return groups.map((g) => ({
    name: g.name,
    items: g.items.map((i) => ({
      href: i.href,
      title: i.title,
      icon: i.icon,
      enabled: i.enabled,
      children: i.children ? i.children.map((c) => ({ href: c.href, title: c.title, icon: c.icon, enabled: c.enabled })) : undefined,
    })),
  }))
}
