'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Box, ChevronRight, Layers, LayoutDashboard, Palette, SwatchBook } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { cn } from '@open-mercato/shared/lib/utils'
import type { NavGroup } from '@/lib/manifest'

type SideNavProps = {
  groups: NavGroup[]
  onNavigate?: () => void
}

const SECTION_ORDER: NavGroup['group'][] = ['blocks', 'components', 'foundations']
const SECTION_ICONS = { blocks: Layers, components: Box, foundations: SwatchBook }
const INDEX_LABELS = {
  foundations: 'design.nav.allFoundations',
  components: 'design.nav.allComponents',
  blocks: 'design.nav.allBlocks',
}

function NavLink({ href, active, children, onNavigate }: { href: string; active: boolean; children: React.ReactNode; onNavigate?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex min-h-8 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:shadow-focus',
        active ? 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground before:absolute before:inset-y-2 before:start-0 before:w-0.5 before:rounded-full before:bg-sidebar-foreground' : 'text-muted-foreground hover:bg-muted hover:text-sidebar-foreground',
      )}
    >
      {children}
    </Link>
  )
}

export function SideNav({ groups, onNavigate }: SideNavProps) {
  const t = useT()
  const route = usePathname() ?? '/'
  const pathname = route.endsWith('/') ? route : `${route}/`
  const [query, setQuery] = React.useState('')
  const filter = query.trim().toLowerCase()
  const sections = SECTION_ORDER.flatMap((key) => {
    const group = groups.find((section) => section.group === key)
    if (!group) return []
    const items = filter
      ? group.items.filter((item) => (item.title + ' ' + item.id).toLowerCase().includes(filter))
      : group.items
    return items.length ? [{ key, items }] : []
  })
  const navigate = () => {
    setQuery('')
    onNavigate?.()
  }
  const searchLabel = t('design.nav.search')

  return (
    <nav aria-label={t('design.nav.label')} className="om-catalog-nav flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-4 pb-3 pt-4">
        <SearchInput size="sm" className="border-sidebar-border bg-background shadow-none hover:border-input"
          aria-label={searchLabel} placeholder={searchLabel} value={query} onChange={setQuery} />
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-2.5 pb-5">
        {!filter && (
          <div className="mb-2 border-b border-sidebar-border pb-3">
            <NavLink href="/" active={pathname === '/'} onNavigate={navigate}>
              <LayoutDashboard aria-hidden className="size-4 shrink-0" />{t('design.nav.overview')}
            </NavLink>
            <NavLink href="/create/" active={pathname === '/create/' || pathname === '/create'} onNavigate={navigate}>
              <Palette aria-hidden className="size-4 shrink-0" />{t('design.nav.create')}
            </NavLink>
          </div>
        )}
        {sections.map(({ key, items }) => {
          const href = `/${key}/`
          const Icon = SECTION_ICONS[key]
          return (
            <details key={key + (filter ? '-filtered' : '')} open={!!filter || pathname.startsWith(href) || (pathname === '/' && key === 'blocks')} className="group/section">
              <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2.5 rounded-md px-2.5 text-sm font-medium text-sidebar-foreground hover:bg-muted focus-visible:outline-none focus-visible:shadow-focus [&::-webkit-details-marker]:hidden">
                <Icon aria-hidden className="size-4 shrink-0" />
                <span>{t(`design.nav.${key}`)}</span>
                <span className="ml-auto font-mono text-xs font-normal tabular-nums text-muted-foreground">{items.length}</span>
                <ChevronRight aria-hidden className="size-3.5 text-muted-foreground group-open/section:rotate-90" />
              </summary>
              <ul className="mb-2 ml-4.5 mt-0.5 space-y-0.5 border-l border-sidebar-border pl-2">
                {!filter && <li><NavLink href={href} active={pathname === href} onNavigate={navigate}>{t(INDEX_LABELS[key])}</NavLink></li>}
                {items.map((item) => (
                  <li key={item.id}>
                    <NavLink href={item.href} active={pathname === item.href} onNavigate={navigate}>{item.title}</NavLink>
                  </li>
                ))}
              </ul>
            </details>
          )
        })}
        {sections.length === 0 && <p role="status" className="px-2.5 py-3 text-sm text-muted-foreground">{t('design.index.noMatches', { query })}</p>}
      </div>
    </nav>
  )
}
