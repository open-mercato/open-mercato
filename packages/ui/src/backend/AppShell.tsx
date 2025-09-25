"use client"
import * as React from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Separator } from '../primitives/separator'
import { FlashMessages } from './FlashMessages'
import { usePathname } from 'next/navigation'

export type AppShellProps = {
  productName?: string
  email?: string
  groups: { name: string; items: { href: string; title: string; icon: string; enabled?: boolean }[] }[]
  children: React.ReactNode
  rightHeaderSlot?: React.ReactNode
  sidebarCollapsedDefault?: boolean
  currentTitle?: string
  breadcrumb?: Array<{ label: string; href?: string }>
}

const icons: Record<string, React.ReactNode> = {
  home: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 10l9-7 9 7"/><path d="M9 22V12h6v10"/></svg>
  ),
  checklist: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M5 8l2-2M5 14l2-2M5 20l2-2"/></svg>
  ),
  checkbox: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 12l3 3 7-7"/></svg>
  ),
  dashboard: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 13h8V3H3zM13 21h8v-8h-8zM13 3v6h8V3zM3 21h8v-6H3z"/></svg>
  ),
  list: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg>
  ),
  tag: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.59 13.41L11 3H4v7l9.59 9.59a2 2 0 0 0 2.82 0l4.18-4.18a2 2 0 0 0 0-2.82z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>
  ),
  box: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96L12 12l8.73-5.04"/></svg>
  ),
  cart: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 12.39a2 2 0 0 0 2 1.61h7.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
  ),
  inventory: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 8V6a2 2 0 0 0-2-2h-3l-2-2h-4L8 4H5a2 2 0 0 0-2 2v2"/><path d="M3 8h18v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 12v6"/></svg>
  ),
  user: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
  ),
  chart: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/><path d="M7 13v5M12 6v12M17 10v8"/></svg>
  ),
  settings: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c0 .66.26 1.3.73 1.77.47.47 1.11.73 1.77.73H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
  ),
  collection: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="4"/><rect x="3" y="10" width="18" height="10"/></svg>
  ),
  channel: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12h20"/><path d="M7 12a5 5 0 0 1 10 0"/></svg>
  ),
  truck: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7h13v10H3z"/><path d="M16 13h5l-1.5-4H16z"/><circle cx="7.5" cy="18" r="1.5"/><circle cx="18.5" cy="18" r="1.5"/></svg>
  ),
  billing: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/></svg>
  ),
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`transition-transform ${open ? 'rotate-180' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
  )
}

export function AppShell({ productName = 'Admin', email, groups, rightHeaderSlot, children, sidebarCollapsedDefault = false, currentTitle, breadcrumb }: AppShellProps) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [collapsed, setCollapsed] = React.useState(sidebarCollapsedDefault)
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>(() => Object.fromEntries(groups.map(g => [g.name, true])))

  const toggleGroup = (name: string) => setOpenGroups((prev) => ({ ...prev, [name]: !prev[name] }))

  const asideWidth = collapsed ? '72px' : '240px'
  const asideClassesBase = `border-r bg-background/60 py-4 h-svh overflow-y-auto`;

  // Persist collapse state
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem('om:sidebarCollapsed')
      if (saved != null) setCollapsed(saved === '1')
      const savedOpen = localStorage.getItem('om:sidebarOpenGroups')
      if (savedOpen) {
        const parsed = JSON.parse(savedOpen) as Record<string, boolean>
        // only keep known groups
        const base = Object.fromEntries(groups.map(g => [g.name, true])) as Record<string, boolean>
        for (const k of Object.keys(base)) if (k in parsed) base[k] = !!parsed[k]
        setOpenGroups(base)
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  React.useEffect(() => {
    try { localStorage.setItem('om:sidebarCollapsed', collapsed ? '1' : '0') } catch {}
  }, [collapsed])
  React.useEffect(() => {
    try { localStorage.setItem('om:sidebarOpenGroups', JSON.stringify(openGroups)) } catch {}
  }, [openGroups])

  // Ensure current route's group is expanded on load
  React.useEffect(() => {
    const activeGroup = groups.find((g) => g.items.some((i) => pathname?.startsWith(i.href)))?.name
    if (!activeGroup) return
    setOpenGroups((prev) => (prev[activeGroup] === false ? { ...prev, [activeGroup]: true } : prev))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  function renderSidebar(compact: boolean, showCollapseToggle: boolean, hideHeader?: boolean) {
    return (
      <div className="flex flex-col gap-2 min-h-full">
        {!hideHeader && (
          <div className={`flex items-center ${compact ? 'justify-center' : 'justify-between'} mb-2`}>
            <div className="flex items-center gap-2">
              <Image src="/open-mercato.svg" alt="Logo" width={48} height={48} className="rounded" />
              {!compact && <div className="text-sm font-semibold">{productName}</div>}
            </div>
            {/* Collapse toggle removed as requested */}
          </div>
        )}
        <nav className="flex flex-col gap-2">
          {groups.map((g, gi) => {
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
                      const active = pathname?.startsWith(i.href)
                      const base = compact ? 'w-10 h-10 justify-center' : 'px-2 py-1 gap-2'
                      return (
                        <Link
                          key={i.href}
                          href={i.href}
                          className={`relative text-sm rounded inline-flex items-center ${base} ${
                            active ? 'bg-background border shadow-sm' : 'hover:bg-accent hover:text-accent-foreground'
                          } ${i.enabled === false ? 'pointer-events-none opacity-50' : ''}`}
                          aria-disabled={i.enabled === false}
                          title={compact ? i.title : undefined}
                          onClick={() => setMobileOpen(false)}
                        >
                          {active ? (
                            <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded bg-foreground" />
                          ) : null}
                          <span className={`flex items-center justify-center shrink-0 ${compact ? '' : 'text-muted-foreground'}`}>
                            {(i.icon && icons[i.icon]) ? icons[i.icon] : icons['list']}
                          </span>
                          {!compact && <span>{i.title}</span>}
                        </Link>
                      )
                    })}
                  </div>
                )}
                {gi < groups.length - 1 && <div className="my-2 border-t border-dotted" />}
              </div>
            )
          })}
        </nav>
      </div>
    )
  }

  const gridColsClass = collapsed ? 'lg:grid-cols-[72px_1fr]' : 'lg:grid-cols-[240px_1fr]'
  return (
    <div className={`min-h-svh lg:grid ${gridColsClass}`}>
      {/* Desktop sidebar */}
      <aside className={`${asideClassesBase} ${collapsed ? 'px-2' : 'px-3'} hidden lg:block`}>{renderSidebar(collapsed, true)}</aside>

      <div className="flex min-h-svh flex-col">
        <header className="border-b bg-background/60 px-3 lg:px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Mobile menu button */}
            <button type="button" className="lg:hidden rounded border px-2 py-1" aria-label="Open menu" onClick={() => setMobileOpen(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
            </button>
            {/* Desktop collapse toggle */}
            <button type="button" className="hidden lg:inline-flex rounded border px-2 py-1" aria-label="Toggle collapse" onClick={() => setCollapsed((c) => !c)}>
              {collapsed ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
              )}
            </button>
            {/* Header breadcrumb (from page meta). */}
            {breadcrumb && breadcrumb.length ? (
              <nav className="flex items-center gap-2 text-sm">
                {breadcrumb.map((b, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span className="text-muted-foreground">/</span>}
                    {b.href ? (
                      <Link href={b.href} className="text-muted-foreground hover:text-foreground">
                        {b.label}
                      </Link>
                    ) : (
                      <span className="font-medium">{b.label}</span>
                    )}
                  </React.Fragment>
                ))}
              </nav>
            ) : (
              <div className="font-semibold text-base lg:text-lg truncate max-w-[60vw]">
                {currentTitle || ''}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm">
            {rightHeaderSlot ? (
              rightHeaderSlot
            ) : (
              <>
                <Separator orientation="vertical" className="w-px h-5 mx-1" />
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
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Image src="/open-mercato.svg" alt="Logo" width={28} height={28} className="rounded" />
                {productName}
              </div>
              <button className="rounded border px-2 py-1" onClick={() => setMobileOpen(false)} aria-label="Close menu">✕</button>
            </div>
            {/* Force expanded sidebar in mobile drawer, hide its header and collapse toggle */}
            {renderSidebar(false, false, true)}
          </aside>
        </div>
      )}
    </div>
  )
}
