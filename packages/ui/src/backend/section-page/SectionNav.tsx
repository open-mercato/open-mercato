'use client'
import * as React from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { hasAllFeatures } from '@open-mercato/shared/security/features'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { IconButton } from '../../primitives/icon-button'
import type { SectionNavGroup, SectionNavItem } from './types'
import { mergeMenuItems } from '../injection/mergeMenuItems'
import { useInjectedMenuItems, type MenuSurfaceId } from '../injection/useInjectedMenuItems'
import { resolveInjectedIcon } from '../injection/resolveInjectedIcon'

const DefaultIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M8 6h13M8 12h13M8 18h13" />
    <path d="M3 6h.01M3 12h.01M3 18h.01" />
  </svg>
)

export type SectionNavProps = {
  title: string
  titleKey?: string
  sections: SectionNavGroup[]
  activePath: string
  userFeatures?: Set<string>
  collapsed: boolean
  onToggleCollapse: () => void
  menuSurfaceId?: MenuSurfaceId
}

export function SectionNav({
  title,
  titleKey,
  sections,
  activePath,
  userFeatures,
  collapsed,
  onToggleCollapse,
  menuSurfaceId,
}: SectionNavProps) {
  const t = useT()
  const { items: injectedMenuItems } = useInjectedMenuItems(menuSurfaceId ?? 'menu:sidebar:settings')
  const grantedFeatureList = React.useMemo(() => (userFeatures ? Array.from(userFeatures) : []), [userFeatures])

  const hasRequiredFeatures = (item: SectionNavItem): boolean => {
    if (!item.requireFeatures || item.requireFeatures.length === 0) return true
    if (!userFeatures) return true
    return hasAllFeatures(grantedFeatureList, item.requireFeatures)
  }

  const resolvedTitle = titleKey ? t(titleKey, title) : title

  const renderItem = (item: SectionNavItem) => {
    const isActive = activePath === item.href || activePath.startsWith(item.href + '/')
    const label = item.labelKey ? t(item.labelKey, item.label) : item.label
    const base = collapsed ? 'w-10 h-10 justify-center' : 'w-full py-2 gap-2'
    const spacingStyle = !collapsed ? { paddingLeft: '12px', paddingRight: '12px' } : undefined

    return (
      <Link
        key={item.id}
        href={item.href}
        className={`relative text-sm font-medium rounded-lg inline-flex items-center transition-colors ${base} ${
          isActive
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:bg-muted'
        }`}
        style={spacingStyle}
        title={collapsed ? label : undefined}
      >
        {isActive && (
          <span aria-hidden className={`absolute ${collapsed ? 'left-[-20px]' : 'left-[-12px]'} top-2 w-1 h-5 rounded-r bg-foreground`} />
        )}
        <span className="flex items-center justify-center shrink-0">
          {item.icon ?? DefaultIcon}
        </span>
        {!collapsed && <span className="truncate">{label}</span>}
      </Link>
    )
  }

  const renderSection = (section: SectionNavGroup) => {
    const sectionInjected = injectedMenuItems.filter((item) => (item.groupId ?? section.id) === section.id)
    const mergedItems = mergeMenuItems(
      section.items.map((item) => ({ id: item.id, item })),
      sectionInjected,
    ).flatMap((item) => {
      if (item.source === 'built-in') {
        const original = section.items.find((entry) => entry.id === item.id)
        return original ? [original] : []
      }
      if (!item.href) return []
      return [{
        id: item.id,
        label: item.labelKey ? t(item.labelKey, item.label ?? item.id) : (item.label ?? item.id),
        href: item.href,
        icon: resolveInjectedIcon(item.icon) ?? undefined,
      }]
    })
    const visibleItems = mergedItems.filter(hasRequiredFeatures)
    if (visibleItems.length === 0) return null

    const sortedItems = [...visibleItems].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    const sectionLabel = section.labelKey ? t(section.labelKey, section.label) : section.label

    return (
      <div key={section.id} className="flex flex-col gap-1">
        {!collapsed && (
          <div className="w-full px-1 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
            {sectionLabel}
          </div>
        )}
        <div className={`flex flex-col ${collapsed ? 'items-center' : ''} gap-1`}>
          {sortedItems.map(renderItem)}
        </div>
      </div>
    )
  }

  const sortedSections = [...sections].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  return (
    <nav className={`flex flex-col gap-3 ${collapsed ? 'items-center' : ''}`}>
      <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'} gap-2`}>
        {!collapsed && (
          <span className="text-sm font-medium truncate">{resolvedTitle}</span>
        )}
        <IconButton
          type="button"
          variant="ghost"
          size="sm"
          onClick={onToggleCollapse}
          title={collapsed ? t('common.expand', 'Expand') : t('common.collapse', 'Collapse')}
          aria-label={collapsed ? t('common.expand', 'Expand') : t('common.collapse', 'Collapse')}
        >
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
        </IconButton>
      </div>
      <div className={`flex flex-col gap-2 ${collapsed ? 'items-center' : ''}`}>
        {sortedSections.map(renderSection)}
      </div>
    </nav>
  )
}
