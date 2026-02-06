'use client'
import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown } from 'lucide-react'

export type CollapsibleNavItem = {
  href: string
  title: string
  icon?: React.ReactNode
  enabled?: boolean
  hidden?: boolean
  children?: CollapsibleNavItem[]
}

export type CollapsibleNavGroup = {
  id: string
  name: string
  items: CollapsibleNavItem[]
}

export type CollapsibleNavSectionProps = {
  title: string
  icon?: React.ReactNode
  groups: CollapsibleNavGroup[]
  defaultExpanded?: boolean
  compact?: boolean
  storageKey?: string
}

const DefaultIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M8 6h13M8 12h13M8 18h13" />
    <path d="M3 6h.01M3 12h.01M3 18h.01" />
  </svg>
)

const STORAGE_KEY = 'om:sidebarSettingsExpanded'

export function CollapsibleNavSection({
  title,
  icon,
  groups,
  defaultExpanded = false,
  compact = false,
  storageKey = STORAGE_KEY,
}: CollapsibleNavSectionProps) {
  const pathname = usePathname()
  // Start with defaultExpanded to avoid hydration mismatch
  const [expanded, setExpanded] = React.useState(defaultExpanded)
  const [mounted, setMounted] = React.useState(false)

  const hasActiveChild = React.useMemo(() => {
    for (const group of groups) {
      for (const item of group.items) {
        if (pathname?.startsWith(item.href)) return true
        if (item.children) {
          for (const child of item.children) {
            if (pathname?.startsWith(child.href)) return true
          }
        }
      }
    }
    return false
  }, [groups, pathname])

  // Read from localStorage after mount to avoid hydration mismatch
  React.useEffect(() => {
    setMounted(true)
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved !== null) {
        setExpanded(saved === '1')
      } else if (hasActiveChild) {
        setExpanded(true)
      }
    } catch {}
  }, [storageKey, hasActiveChild])

  // Auto-expand when navigating to a child page
  React.useEffect(() => {
    if (mounted && hasActiveChild) {
      setExpanded(true)
    }
  }, [mounted, hasActiveChild])

  // Persist to localStorage when expanded changes (after mount)
  React.useEffect(() => {
    if (!mounted) return
    try {
      localStorage.setItem(storageKey, expanded ? '1' : '0')
    } catch {}
  }, [expanded, storageKey, mounted])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setExpanded((prev) => !prev)
    }
  }

  const renderItem = (item: CollapsibleNavItem, depth = 0) => {
    if (item.hidden) return null

    const isActive = pathname?.startsWith(item.href)
    const hasChildren = item.children && item.children.length > 0
    const showChildren = hasChildren && isActive

    const base = compact ? 'w-10 h-10 justify-center' : 'px-2 py-1.5 gap-2'
    const indent = depth > 0 && !compact ? { paddingLeft: `${depth * 16 + 8}px` } : undefined

    return (
      <React.Fragment key={item.href}>
        <Link
          href={item.href}
          style={indent}
          className={`relative text-sm rounded inline-flex items-center ${base} ${
            isActive && !showChildren
              ? 'bg-background border shadow-sm'
              : 'hover:bg-accent hover:text-accent-foreground'
          } ${item.enabled === false ? 'pointer-events-none opacity-50' : ''}`}
          aria-disabled={item.enabled === false}
          title={compact ? item.title : undefined}
        >
          {isActive && !showChildren && (
            <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded bg-foreground" />
          )}
          <span className={`flex items-center justify-center shrink-0 ${compact ? '' : 'text-muted-foreground'}`}>
            {item.icon ?? DefaultIcon}
          </span>
          {!compact && <span className="truncate">{item.title}</span>}
        </Link>
        {showChildren && (
          <div className={`flex flex-col ${compact ? 'items-center' : ''} gap-1`}>
            {item.children!.filter((c) => !c.hidden).map((child) => renderItem(child, depth + 1))}
          </div>
        )}
      </React.Fragment>
    )
  }

  const renderGroup = (group: CollapsibleNavGroup) => {
    const visibleItems = group.items.filter((item) => !item.hidden)
    if (visibleItems.length === 0) return null

    return (
      <div key={group.id} className="flex flex-col gap-1">
        {!compact && (
          <div className="px-2 py-1 text-xs uppercase text-muted-foreground/90">{group.name}</div>
        )}
        {visibleItems.map((item) => renderItem(item))}
      </div>
    )
  }

  const settingsIcon = icon || (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )

  return (
    <div className="border-t pt-2">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        onKeyDown={handleKeyDown}
        className={`w-full ${compact ? 'px-0 justify-center' : 'px-2 justify-between'} flex items-center text-xs uppercase text-muted-foreground/90 py-2 hover:text-foreground`}
        aria-expanded={expanded}
        aria-controls="collapsible-nav-content"
      >
        <span className="flex items-center gap-2">
          {settingsIcon}
          {!compact && <span>{title}</span>}
        </span>
        {!compact && (
          <ChevronDown
            className={`size-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        )}
      </button>
      {expanded && (
        <div id="collapsible-nav-content" className={`flex flex-col gap-2 ${!compact ? 'pl-1' : 'items-center'} mt-1`}>
          {groups.map(renderGroup)}
        </div>
      )}
    </div>
  )
}
