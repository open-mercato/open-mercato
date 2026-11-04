"use client"

import * as React from 'react'
import { MoreHorizontal, Plus } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { Tabs, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import type { SectionAction } from '@open-mercato/ui/backend/detail'

export type DetailTabRailTab = {
  id: string
  label: string
  icon?: React.ReactNode
  count?: React.ReactNode
}

export type DetailTabRailProps = {
  tabs: DetailTabRailTab[]
  activeTab: string
  onTabChange: (tab: string) => void
  listLabel: string
  moreLabel: string
  sectionAction?: SectionAction | null
  contentClassName?: string
  /** True while tabs can still arrive, such as injected tabs that are loading. */
  busy?: boolean
  children: React.ReactNode
}

function tabSignature(tab: { id: string; label: string; count?: React.ReactNode }, activeTab: string): string {
  return `${tab.label}\u0000${tab.count == null ? '' : String(tab.count)}\u0000${tab.id === activeTab ? 'selected' : ''}`
}

function moveMoreMenuFocus(event: React.KeyboardEvent<HTMLDivElement>, close: () => void) {
  if (event.key === 'Tab') {
    event.preventDefault()
    close()
    return
  }
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'))
  if (items.length === 0) return
  const focused = items.indexOf(document.activeElement as HTMLElement)
  let next: number
  switch (event.key) {
    case 'ArrowDown':
      next = (focused + 1) % items.length
      break
    case 'ArrowUp':
      next = focused <= 0 ? items.length - 1 : focused - 1
      break
    case 'Home':
      next = 0
      break
    case 'End':
      next = items.length - 1
      break
    default:
      return
  }
  event.preventDefault()
  items[next]?.focus()
}

/** Fallback split when widths cannot be measured (jsdom): this many tabs inline, the rest in More. */
export const PRIMARY_TAB_LIMIT = 6

/**
 * Priority+ tab rail shared by the CRM detail pages (#7487): every tab renders once to
 * learn its width before paint, then only the tabs that fit beside the More trigger stay
 * inline and the rest fold into a menu. The strip never scrolls on either axis, the active
 * tab is lifted inline when it would overflow, and keyboard Arrow/Home/End navigation keeps
 * working on the inline set. jsdom reports zero widths, so it falls back to PRIMARY_TAB_LIMIT.
 */
export function DetailTabRail({
  tabs,
  activeTab,
  onTabChange,
  listLabel,
  moreLabel,
  sectionAction = null,
  contentClassName = 'pt-6',
  busy = false,
  children,
}: DetailTabRailProps) {
  const rowRef = React.useRef<HTMLDivElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const moreRef = React.useRef<HTMLButtonElement>(null)
  const moreMenuRef = React.useRef<HTMLDivElement>(null)
  const [moreOpen, setMoreOpen] = React.useState(false)
  // Width per tab id, keyed to the label, count and selected state it was measured with: counts
  // arrive after the first paint and the selected tab is heavier, so both widen a tab and a
  // changed signature triggers a fresh measurement.
  const widthsRef = React.useRef<Map<string, { width: number; signature: string }>>(new Map())
  const moreWidthRef = React.useRef(0)
  const listChromeRef = React.useRef(0)
  const remeasureRetriesRef = React.useRef(0)
  const [visibleIds, setVisibleIds] = React.useState<string[] | null>(null)

  const measuring = visibleIds === null || tabs.some((tab) => widthsRef.current.get(tab.id)?.signature !== tabSignature(tab, activeTab))

  React.useLayoutEffect(() => {
    const row = rowRef.current
    const list = listRef.current
    if (!row || !list) return

    const tabList = list.querySelector<HTMLElement>('[role="tablist"]')
    const gap = tabList ? Number.parseFloat(getComputedStyle(tabList).columnGap || '0') || 0 : 0

    const compute = () => {
      if (measuring) {
        const rendered = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]'))
        let tabsWidth = 0
        rendered.forEach((element, index) => {
          const tab = tabs[index]
          const width = element.getBoundingClientRect().width
          tabsWidth += width
          if (tab) widthsRef.current.set(tab.id, { width, signature: tabSignature(tab, activeTab) })
        })
        if (moreRef.current) moreWidthRef.current = moreRef.current.getBoundingClientRect().width
        if (tabList) {
          const gaps = Math.max(0, rendered.length - 1) * gap
          listChromeRef.current = Math.max(0, tabList.getBoundingClientRect().width - tabsWidth - gaps)
        }
      }
      const available = list.clientWidth - listChromeRef.current - 1
      // Styles can still be settling right after hydration, so a visible strip may have measured
      // its tabs at 0: drop those entries and measure again on the next frame (a few times at most).
      const unmeasured = tabs.some((tab) => (widthsRef.current.get(tab.id)?.width ?? 0) === 0)
      if (unmeasured && list.clientWidth > 0 && remeasureRetriesRef.current < 5) {
        remeasureRetriesRef.current += 1
        requestAnimationFrame(() => {
          for (const tab of tabs) {
            if ((widthsRef.current.get(tab.id)?.width ?? 0) === 0) widthsRef.current.delete(tab.id)
          }
          setVisibleIds(null)
        })
        return
      }
      let next: string[]
      if (available <= 0) {
        const inline = tabs.slice(0, PRIMARY_TAB_LIMIT).map((tab) => tab.id)
        next = inline.includes(activeTab) || !tabs.some((tab) => tab.id === activeTab) ? inline : [...inline, activeTab]
      } else {
        const widthOf = (id: string) => widthsRef.current.get(id)?.width ?? 0
        const total = tabs.reduce((sum, tab) => sum + widthOf(tab.id) + gap, 0) - gap
        if (total <= available) {
          next = tabs.map((tab) => tab.id)
        } else {
          const budget = available - moreWidthRef.current
          let used = 0
          next = []
          for (const tab of tabs) {
            const width = widthOf(tab.id) + gap
            if (used + width > budget) break
            next.push(tab.id)
            used += width
          }
          if (!next.includes(activeTab) && tabs.some((tab) => tab.id === activeTab)) {
            const activeWidth = widthOf(activeTab) + gap
            while (next.length > 0 && used + activeWidth > budget) {
              const removed = next.pop() as string
              used -= widthOf(removed) + gap
            }
            next.push(activeTab)
          }
        }
      }
      // A measuring pass rendered every tab, so it must end in a new render even when the
      // inline set is unchanged (a tab that went straight into More), or the strip stays unfolded.
      setVisibleIds((current) => (!measuring && current && current.join('|') === next.join('|') ? current : next))
    }

    compute()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => compute())
    observer.observe(list)
    return () => observer.disconnect()
  }, [activeTab, tabs, measuring])

  const visibleTabs = React.useMemo(() => {
    if (measuring || !visibleIds) return tabs
    const byId = new Map(tabs.map((tab) => [tab.id, tab]))
    return visibleIds.map((id) => byId.get(id)).filter((tab): tab is DetailTabRailTab => Boolean(tab))
  }, [tabs, measuring, visibleIds])
  const overflowTabs = React.useMemo(() => {
    if (measuring || !visibleIds) return []
    const visible = new Set(visibleIds)
    return tabs.filter((tab) => !visible.has(tab.id))
  }, [tabs, measuring, visibleIds])
  const showMore = measuring || overflowTabs.length > 0

  React.useEffect(() => {
    if (!showMore) setMoreOpen(false)
  }, [showMore])

  return (
    <div>
      <div ref={rowRef} data-testid="detail-tabs-row" aria-busy={busy} className="flex items-end justify-between gap-2 border-b">
        <div ref={listRef} className="flex min-w-0 flex-1 flex-nowrap items-end overflow-hidden">
          <Tabs value={activeTab} onValueChange={onTabChange} variant="underline" className="shrink-0">
            <TabsList aria-label={listLabel} className="-mb-px flex-nowrap border-b-0 px-1">
              {visibleTabs.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id} leading={tab.icon} count={tab.count}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {showMore ? (
            <Popover open={moreOpen} onOpenChange={setMoreOpen}>
              <PopoverTrigger asChild>
                <Button
                  data-testid="detail-tabs-more"
                  ref={moreRef}
                  type="button"
                  variant="ghost"
                  aria-haspopup="menu"
                  className="group -mb-px h-auto shrink-0 rounded-b-none rounded-t-md border-b-2 border-transparent px-3 py-2 text-muted-foreground hover:bg-accent-indigo/10 hover:text-accent-indigo dark:hover:bg-accent-indigo/10"
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowDown') return
                    event.preventDefault()
                    setMoreOpen(true)
                  }}
                >
                  <span aria-hidden="true" className="inline-flex size-5 shrink-0 items-center justify-center text-muted-foreground group-hover:text-accent-indigo">
                    <MoreHorizontal className="size-5" />
                  </span>
                  {moreLabel}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-52 p-1"
                onOpenAutoFocus={(event) => {
                  event.preventDefault()
                  moreMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
                }}
              >
                <div
                  ref={moreMenuRef}
                  role="menu"
                  aria-label={moreLabel}
                  className="flex flex-col"
                  onKeyDown={(event) => moveMoreMenuFocus(event, () => setMoreOpen(false))}
                >
                  {overflowTabs.map((tab) => (
                    <PopoverClose key={tab.id} asChild>
                      <Button
                        type="button"
                        role="menuitem"
                        tabIndex={-1}
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start"
                        onClick={() => onTabChange(tab.id)}
                      >
                        {tab.icon}
                        <span className="min-w-0 flex-1 truncate text-left">{tab.label}</span>
                        {tab.count !== undefined ? (
                          <span className="text-xs text-muted-foreground">{tab.count}</span>
                        ) : null}
                      </Button>
                    </PopoverClose>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
        {sectionAction ? (
          <div className="shrink-0">
            <Button
              type="button"
              size="sm"
              onClick={sectionAction.onClick}
              disabled={sectionAction.disabled}
              className="mb-1.5 mr-1"
            >
              <Plus className="mr-1.5 h-4 w-4" />
              {sectionAction.label}
            </Button>
          </div>
        ) : null}
      </div>

      <div className={contentClassName} role="tabpanel">
        {children}
      </div>
    </div>
  )
}
