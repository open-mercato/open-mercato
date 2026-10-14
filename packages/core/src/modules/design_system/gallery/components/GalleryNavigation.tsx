'use client'

import * as React from 'react'
import { GalleryLink as Link } from './GalleryLink'
import { ChevronRight, Menu, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import type { SectionNavGroup, SectionNavItem } from '@open-mercato/ui/backend/section-page'
import { useInjectedMenuItems } from '@open-mercato/ui/backend/injection/useInjectedMenuItems'
import { mergeMenuItems } from '@open-mercato/ui/backend/injection/mergeMenuItems'
import { resolveInjectedIcon } from '@open-mercato/ui/backend/injection/resolveInjectedIcon'

export function GalleryNavigation({ sections, activePath, activeFamilyId, onExpand, onNavigate, failed, onRetry }: {
  sections: SectionNavGroup[]
  activePath: string
  activeFamilyId: string | null
  onExpand: (id: string) => void
  onNavigate: () => void
  failed: Record<string, boolean>
  onRetry: (id: string) => void
}) {
  const t = useT()
  const prefix = React.useId()
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({})
  const { items: injectedItems } = useInjectedMenuItems('menu:sidebar:settings:design_system')
  React.useEffect(() => {
    if (activeFamilyId) setExpanded(previous => ({ ...previous, [activeFamilyId]: true }))
    setMobileOpen(false)
  }, [activeFamilyId, activePath])

  const navigate = () => { setMobileOpen(false); onNavigate() }
  const itemLabel = (item: SectionNavItem) => t(item.labelKey ?? item.label, item.label)
  const renderLink = (item: SectionNavItem, nested = false) => {
    const active = activePath === item.href
    return <Button asChild variant="ghost" size="sm" className={cn('w-full min-w-0 justify-start gap-2 rounded-md px-3 text-left text-sm font-normal text-muted-foreground', !nested && 'w-0 flex-1', active && 'bg-accent font-semibold text-accent-foreground', nested && 'border-l-2 rounded-l-none', nested && (active ? 'border-foreground' : 'border-transparent'))}>
      <Link href={item.href} aria-current={active ? 'page' : undefined} onClick={navigate}>
        {!nested && item.icon ? <span className="shrink-0" aria-hidden>{item.icon}</span> : null}
        <span className="min-w-0 truncate">{itemLabel(item)}</span>
      </Link>
    </Button>
  }
  const renderItem = (item: SectionNavItem) => {
    const expandable = item.children !== undefined
    const open = expanded[item.id] ?? false
    const label = itemLabel(item)
    const contentId = `${prefix}-${item.id}`
    return <li key={item.id} className="min-w-0">
      <div className="flex min-w-0 items-center gap-1">
        {renderLink(item)}
        {expandable ? <IconButton type="button" variant="ghost" size="sm" className="shrink-0 text-muted-foreground" aria-label={t(open ? 'design_system.gallery.navigation.collapse' : 'design_system.gallery.navigation.expand', { category: label })} aria-expanded={open} aria-controls={contentId} onClick={() => {
          setExpanded(previous => ({ ...previous, [item.id]: !open }))
          if (!open) onExpand(item.id)
        }}><ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} /></IconButton> : null}
      </div>
      {expandable && open ? <div id={contentId} className="mb-2 ml-5 mt-1 border-l border-border pl-2">
        {failed[item.id] ? <Button type="button" variant="ghost" size="sm" onClick={() => onRetry(item.id)}>{t('design_system.gallery.retry')}</Button> : item.children?.length ? <ul className="space-y-0.5">{item.children.map(child => <li key={child.id}>{renderLink(child, true)}</li>)}</ul> : <div className="space-y-2 p-2" role="status" aria-label={t('common.loading', 'Loading…')}><Skeleton className="h-5 w-3/4" /><Skeleton className="h-5 w-1/2" /></div>}
      </div> : null}
    </li>
  }
  return <aside className="sticky top-16 z-20 min-w-0 bg-background lg:top-20 lg:w-60 lg:shrink-0 lg:self-start lg:border-r lg:border-border">
    <Button type="button" variant="outline" className="my-2 w-full justify-between lg:hidden" aria-expanded={mobileOpen} aria-controls={`${prefix}-navigation`} onClick={() => setMobileOpen(value => !value)}>
      {t('design_system.gallery.navigation.browse')}{mobileOpen ? <X aria-hidden /> : <Menu aria-hidden />}
    </Button>
    <nav id={`${prefix}-navigation`} aria-label={t('design_system.gallery.navigation.label')} className={cn('max-h-screen overflow-y-auto overscroll-contain py-4 pr-3 pb-24 lg:block', !mobileOpen && 'hidden')}>
      <Link href="/backend/design-system" onClick={navigate} className="mb-5 block px-3 text-base font-semibold tracking-tight">{t('design_system.nav.title')}</Link>
      <div className="space-y-5">{sections.map(section => {
        const additions = injectedItems.filter(item => (item.groupId ?? section.id) === section.id)
        const items = mergeMenuItems(section.items.map(item => ({ id: item.id, item })), additions).flatMap(item => {
          if (item.source === 'built-in') {
            const original = section.items.find(candidate => candidate.id === item.id)
            return original ? [original] : []
          }
          return item.href ? [{ id: item.id, label: item.label ?? item.id, labelKey: item.labelKey, href: item.href, icon: resolveInjectedIcon(item.icon) }] : []
        })
        return <section key={section.id}>
          {section.label ? <p className="mb-2 px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t(section.labelKey ?? section.label, section.label)}</p> : null}
          <ul className="space-y-1">{items.map(item => renderItem(item))}</ul>
        </section>
      })}</div>
    </nav>
  </aside>
}
