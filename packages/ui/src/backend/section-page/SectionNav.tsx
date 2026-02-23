'use client'
import * as React from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { IconButton } from '../../primitives/icon-button'
import type { SectionNavGroup, SectionNavItem } from './types'

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
}

export function SectionNav({
  title,
  titleKey,
  sections,
  activePath,
  userFeatures,
  collapsed,
  onToggleCollapse,
}: SectionNavProps) {
  const t = useT()

  const hasRequiredFeatures = (item: SectionNavItem): boolean => {
    if (!item.requireFeatures || item.requireFeatures.length === 0) return true
    if (!userFeatures) return true
    return item.requireFeatures.every((f) => userFeatures.has(f))
  }

  const resolvedTitle = titleKey ? t(titleKey, title) : title

  const renderItem = (item: SectionNavItem) => {
    const isActive = activePath === item.href || activePath.startsWith(item.href + '/')
    const label = item.labelKey ? t(item.labelKey, item.label) : item.label

    return (
      <Link
        key={item.id}
        href={item.href}
        className={`relative text-sm rounded px-3 py-1.5 flex items-center gap-2 transition-colors ${
          isActive
            ? 'bg-background border shadow-sm font-medium'
            : 'hover:bg-accent hover:text-accent-foreground'
        }`}
        title={collapsed ? label : undefined}
      >
        {isActive && (
          <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded bg-foreground" />
        )}
        <span className="flex items-center justify-center shrink-0 text-muted-foreground">
          {item.icon ?? DefaultIcon}
        </span>
        {!collapsed && <span className="truncate">{label}</span>}
      </Link>
    )
  }

  const renderSection = (section: SectionNavGroup) => {
    const visibleItems = section.items.filter(hasRequiredFeatures)
    if (visibleItems.length === 0) return null

    const sortedItems = [...visibleItems].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    const sectionLabel = section.labelKey ? t(section.labelKey, section.label) : section.label

    return (
      <div key={section.id} className="flex flex-col gap-1">
        {!collapsed && (
          <div className="px-3 py-1.5 text-xs uppercase text-muted-foreground/80 font-medium">
            {sectionLabel}
          </div>
        )}
        {sortedItems.map(renderItem)}
      </div>
    )
  }

  const sortedSections = [...sections].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  return (
    <nav className={`flex flex-col gap-4 p-3 ${collapsed ? 'items-center' : ''}`}>
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
      <div className="border-t" />
      <div className={`flex flex-col gap-4 ${collapsed ? 'items-center' : ''}`}>
        {sortedSections.map(renderSection)}
      </div>
    </nav>
  )
}
