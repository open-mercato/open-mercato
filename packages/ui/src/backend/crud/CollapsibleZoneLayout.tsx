'use client'
import * as React from 'react'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '../../primitives/button'
import { useZoneCollapse } from './useZoneCollapse'
import type { LucideIcon } from 'lucide-react'

const SIDE_BY_SIDE_MIN_WIDTH = 1280

export interface ZoneSectionDescriptor {
  id: string
  icon: LucideIcon
  label: string
  errorCount?: number
}

export interface CollapsibleZoneLayoutProps {
  zone1: React.ReactNode
  zone2: React.ReactNode
  entityName: string
  pageType: string
  zone1DefaultWidth?: string
  errorCount?: number
  isDirty?: boolean
  /** Section descriptors for the collapsed rail icon sidebar. When omitted the rail shows the legacy minimal view. */
  sections?: ZoneSectionDescriptor[]
}

function subscribeViewport(callback: () => void) {
  const mediaQuery = window.matchMedia('(min-width: 1024px)')
  mediaQuery.addEventListener('change', callback)
  return () => mediaQuery.removeEventListener('change', callback)
}

function getViewportSnapshot() {
  return window.matchMedia('(min-width: 1024px)').matches
}

function getViewportServerSnapshot() {
  return false
}

export function CollapsibleZoneLayout({
  zone1,
  zone2,
  entityName,
  pageType,
  zone1DefaultWidth,
  errorCount = 0,
  isDirty = false,
  sections,
}: CollapsibleZoneLayoutProps) {
  const t = useT()
  const { collapsed, setCollapsed } = useZoneCollapse(pageType)
  const canCollapse = React.useSyncExternalStore(
    subscribeViewport,
    getViewportSnapshot,
    getViewportServerSnapshot,
  )
  const layoutRef = React.useRef<HTMLDivElement>(null)
  const expandButtonRef = React.useRef<HTMLButtonElement>(null)
  const [containerWidth, setContainerWidth] = React.useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth))
  const [expandedWhileConstrained, setExpandedWhileConstrained] = React.useState(false)

  React.useEffect(() => {
    const node = layoutRef.current
    if (!node) return

    const updateWidth = (nextWidth: number) => {
      setContainerWidth((prev) => (Math.abs(prev - nextWidth) < 1 ? prev : nextWidth))
    }

    const measure = () => {
      updateWidth(node.getBoundingClientRect().width || window.innerWidth)
    }

    measure()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      updateWidth(entry.contentRect.width)
    })

    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const canShowSideBySide = containerWidth >= SIDE_BY_SIDE_MIN_WIDTH

  React.useEffect(() => {
    if (canShowSideBySide) {
      setExpandedWhileConstrained(false)
    }
  }, [canShowSideBySide])

  const showCollapsedRail = canCollapse && (collapsed || (!canShowSideBySide && !expandedWhileConstrained))
  const showStackedExpanded = !showCollapsedRail && !canShowSideBySide
  const layoutMode = showCollapsedRail ? 'collapsed' : showStackedExpanded ? 'stacked' : 'side-by-side'
  const zone1SideBySideStyle = zone1DefaultWidth
    ? { width: zone1DefaultWidth, flexBasis: zone1DefaultWidth }
    : undefined

  const handleExpand = React.useCallback(() => {
    if (!canCollapse) return
    setCollapsed(false)
    setExpandedWhileConstrained(!canShowSideBySide)
  }, [canCollapse, canShowSideBySide, setCollapsed])

  const handleCollapse = React.useCallback(() => {
    if (!canCollapse) return
    setExpandedWhileConstrained(false)
    setCollapsed(true)
    requestAnimationFrame(() => {
      expandButtonRef.current?.focus()
    })
  }, [canCollapse, setCollapsed])

  return (
    <div
      ref={layoutRef}
      data-zone-layout-mode={layoutMode}
      className={cn(
        'flex gap-4',
        showStackedExpanded ? 'flex-col' : 'flex-col lg:flex-row',
      )}
    >
      {showCollapsedRail ? (
        <>
          <div className="hidden lg:flex shrink-0 flex-col items-center gap-3">
            <Button
              ref={expandButtonRef}
              type="button"
              variant="default"
              size="sm"
              onClick={handleExpand}
              className="h-auto rounded-[10px] px-1.5 py-2 shadow-sm"
              aria-label={t('ui.zone.expand', 'Expand form panel')}
            >
              <ChevronsRight className="size-4" />
            </Button>
            {sections?.length ? (
              <div className="flex flex-col items-center gap-2 rounded-[14px] border border-border/70 bg-card px-2 py-3">
                {sections.map((section) => {
                  const SectionIcon = section.icon
                  const hasErrors = Boolean(section.errorCount && section.errorCount > 0)
                  return (
                    <div
                      key={section.id}
                      className="relative flex size-9 items-center justify-center rounded-[10px] border border-transparent bg-muted/70 text-muted-foreground"
                      title={section.label}
                    >
                      <SectionIcon className="size-4" />
                      {hasErrors ? (
                        <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-destructive" />
                      ) : null}
                    </div>
                  )
                })}
              </div>
            ) : null}
          </div>
          {/* Zone 2 takes full width */}
          <div className="min-w-0 flex-1">
            {zone2}
          </div>
        </>
      ) : showStackedExpanded ? (
        <>
          <div className="w-full space-y-2">
            {canCollapse ? (
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCollapse}
                  className="h-auto rounded-[6px] border bg-card px-1.5 py-2"
                  aria-label={t('ui.zone.collapse', 'Collapse form panel')}
                >
                  <ChevronsLeft className="size-4" />
                </Button>
              </div>
            ) : null}
            <div className="w-full">
              {zone1}
            </div>
          </div>

          <div className="min-w-0 w-full">
            {zone2}
          </div>
        </>
      ) : (
        <>
          {/* Zone 1 — CrudForm area */}
          <div
            className={cn('w-full lg:shrink-0', zone1DefaultWidth ? undefined : 'lg:w-[40%]')}
            style={zone1SideBySideStyle}
          >
            {zone1}
          </div>

          {/* Divider with collapse toggle */}
          <div className="hidden lg:flex relative shrink-0 w-8 items-start justify-center pt-4">
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCollapse}
              className="relative z-10 h-auto rounded-[6px] border bg-card px-1.5 py-2"
              aria-label={t('ui.zone.collapse', 'Collapse form panel')}
            >
              <ChevronsLeft className="size-4" />
            </Button>
          </div>

          {/* Zone 2 — Tabs / related data area */}
          <div className="min-w-0 w-full lg:flex-1">
            {zone2}
          </div>
        </>
      )}
    </div>
  )
}
