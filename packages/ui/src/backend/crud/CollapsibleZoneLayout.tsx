'use client'
import * as React from 'react'
import { ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '../../primitives/button'
import { IconButton } from '../../primitives/icon-button'
import { useZoneCollapse } from './useZoneCollapse'

export interface CollapsibleZoneLayoutProps {
  zone1: React.ReactNode
  zone2: React.ReactNode
  entityName: string
  pageType: string
  zone1DefaultWidth?: string
  errorCount?: number
  isDirty?: boolean
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
  errorCount = 0,
  isDirty = false,
}: CollapsibleZoneLayoutProps) {
  const t = useT()
  const { collapsed, toggle, setCollapsed } = useZoneCollapse(pageType)
  const canCollapse = React.useSyncExternalStore(
    subscribeViewport,
    getViewportSnapshot,
    getViewportServerSnapshot,
  )
  const effectiveCollapsed = canCollapse && collapsed
  const expandButtonRef = React.useRef<HTMLButtonElement>(null)

  const handleCollapse = React.useCallback(() => {
    if (!canCollapse) return
    toggle()
    requestAnimationFrame(() => {
      expandButtonRef.current?.focus()
    })
  }, [canCollapse, toggle])

  const handleExpandWithErrors = React.useCallback(() => {
    setCollapsed(false)
  }, [setCollapsed])

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* Zone 1 — CrudForm area */}
      <div
        className={cn(
          'motion-safe:transition-all motion-safe:duration-250',
          effectiveCollapsed
            ? 'hidden lg:flex lg:w-12 lg:flex-col lg:items-center lg:gap-2 lg:py-3 lg:border lg:rounded-lg lg:bg-card lg:shrink-0'
            : 'w-full lg:w-[40%] lg:shrink-0'
        )}
      >
        {effectiveCollapsed ? (
          <>
            <IconButton
              ref={expandButtonRef}
              variant="ghost"
              size="sm"
              type="button"
              onClick={toggle}
              aria-label={t('ui.zone.expand', 'Expand form panel')}
            >
              <ChevronRight className="size-4" />
            </IconButton>
            {errorCount > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleExpandWithErrors}
                className="h-auto min-w-0 flex-col gap-0.5 px-1 py-1 text-destructive hover:text-destructive"
                title={t('ui.zone.validationErrors', '{{count}} validation error(s)', { count: errorCount })}
              >
                <AlertCircle className="size-4" />
                <span className="text-[10px] font-medium">{errorCount}</span>
              </Button>
            )}
            {isDirty && (
              <span
                className="size-2 rounded-full bg-amber-500"
                title={t('ui.zone.unsavedChanges', 'Unsaved changes')}
              />
            )}
            <span
              className="mt-2 text-xs text-muted-foreground font-medium truncate max-w-[2.5rem]"
              style={{ writingMode: 'vertical-lr', textOrientation: 'mixed' }}
              title={entityName}
            >
              {entityName}
            </span>
          </>
        ) : (
          <div className="relative">
            {zone1}
            <div className="hidden lg:flex absolute top-2 right-2">
              <IconButton
                variant="ghost"
                size="xs"
                type="button"
                onClick={handleCollapse}
                aria-label={t('ui.zone.collapse', 'Collapse form panel')}
              >
                <ChevronLeft className="size-3" />
              </IconButton>
            </div>
          </div>
        )}
      </div>

      {/* Zone 2 — Tabs / related data area */}
      <div className={cn(
        'min-w-0',
        effectiveCollapsed ? 'flex-1' : 'w-full lg:flex-1'
      )}>
        {zone2}
      </div>
    </div>
  )
}
