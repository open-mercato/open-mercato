"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tabs, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import {
  SquareCheckBig,
  Mail,
  Briefcase,
  Building2,
  Check,
  History,
  MoreHorizontal,
  Paperclip,
  Plus,
  MapPin,
} from 'lucide-react'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import type { SectionAction } from '@open-mercato/ui/backend/detail'
import { registerComponent } from '@open-mercato/shared/modules/widgets/component-registry'
import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'

export const PERSON_DETAIL_TAB_IDS = ['activities', 'emails', 'deals', 'companies', 'addresses', 'tasks', 'changelog', 'files'] as const

export type PersonTabId =
  | 'activities'
  | 'emails'
  | 'deals'
  | 'companies'
  | 'addresses'
  | 'tasks'
  | 'changelog'
  | 'files'
  | string

type TabDef = {
  id: PersonTabId
  label: string
  icon?: React.ReactNode
  count?: React.ReactNode
  priority?: number
}

export const PERSON_DETAIL_TABS_COMPONENT_ID = 'section:customers.people.detailTabs'

export type PersonDetailTabsProps = {
  activeTab: PersonTabId
  onTabChange: (tab: PersonTabId) => void
  injectedTabs?: Array<{ id: string; label: string; priority?: number }>
  isLoadingInjectedTabs?: boolean
  hiddenTabIds?: string[]
  activitiesCount?: number
  dealsCount?: number
  companiesCount?: number
  addressesCount?: number
  tasksCount?: number
  filesCount?: number
  sectionAction?: SectionAction | null
  children: React.ReactNode
}

function tabSignature(tab: { id: string; label: string; count?: React.ReactNode }, activeTab: string): string {
  return `${tab.label}\u0000${tab.count == null ? '' : String(tab.count)}\u0000${tab.id === activeTab ? 'selected' : ''}`
}

/** Fallback split when widths cannot be measured (jsdom): this many tabs inline, the rest in More. */
const PRIMARY_TAB_LIMIT = 6

const SUPPORTED_TAB_IDS = new Set<PersonTabId>(['activities', 'emails', 'deals', 'companies', 'addresses', 'tasks', 'changelog', 'files'])

export function resolveLegacyTab(tab: string | null | undefined, knownTabIds?: Iterable<string>): PersonTabId {
  if (!tab) return 'activities'
  if (SUPPORTED_TAB_IDS.has(tab as PersonTabId)) return tab as PersonTabId
  if (knownTabIds && new Set(knownTabIds).has(tab)) return tab
  return 'activities'
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

function formatTabCount(count: number): string | number | undefined {
  if (count <= 0) return undefined
  return count > 999 ? '999+' : count
}

function DefaultPersonDetailTabs({
  activeTab,
  onTabChange,
  injectedTabs = [],
  isLoadingInjectedTabs = false,
  hiddenTabIds = [],
  activitiesCount = 0,
  dealsCount = 0,
  companiesCount = 0,
  addressesCount = 0,
  tasksCount = 0,
  filesCount = 0,
  sectionAction = null,
  children,
}: PersonDetailTabsProps) {
  const t = useT()

  const builtInTabs: TabDef[] = React.useMemo(
    () => [
      {
        id: 'activities',
        label: t('customers.people.detail.tabs.activities', 'Activities'),
        icon: <SquareCheckBig className="size-4" />,
        count: formatTabCount(activitiesCount),
      },
      {
        id: 'emails',
        label: t('customers.people.detail.tabs.emails', 'Emails'),
        icon: <Mail className="size-4" />,
      },
      {
        id: 'deals',
        label: t('customers.people.detail.tabs.deals', 'Deals'),
        icon: <Briefcase className="size-4" />,
        count: formatTabCount(dealsCount),
      },
      {
        id: 'companies',
        label: t('customers.people.detail.tabs.companies', 'Companies'),
        icon: <Building2 className="size-4" />,
        count: formatTabCount(companiesCount),
      },
      {
        id: 'tasks',
        label: t('customers.people.detail.tabs.tasks', 'Tasks'),
        icon: <Check className="size-4" />,
        count: formatTabCount(tasksCount),
      },
      {
        id: 'files',
        label: t('customers.people.detail.tabs.files', 'Files'),
        icon: <Paperclip className="size-4" />,
        count: formatTabCount(filesCount),
      },
      {
        id: 'addresses',
        label: t('customers.people.detail.tabs.addresses', 'Addresses'),
        icon: <MapPin className="size-4" />,
        count: formatTabCount(addressesCount),
      },
      {
        id: 'changelog',
        label: t('customers.people.detail.tabs.changelog', 'Change log'),
        icon: <History className="size-4" />,
        count: 'NEW',
      },
    ],
    [t, activitiesCount, dealsCount, companiesCount, addressesCount, tasksCount, filesCount],
  )

  const allTabs: TabDef[] = React.useMemo(() => {
    const hidden = new Set(hiddenTabIds)
    return [
      ...builtInTabs,
      ...injectedTabs.filter((tab, index) => !builtInTabs.some((native) => native.id === tab.id) && injectedTabs.findIndex((candidate) => candidate.id === tab.id) === index).map((tab) => ({
        id: tab.id as PersonTabId,
        label: tab.label,
        priority: tab.priority,
      })),
    ]
      .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0))
      .filter((tab) => !hidden.has(tab.id))
  }, [builtInTabs, hiddenTabIds, injectedTabs])

  React.useEffect(() => {
    if (isLoadingInjectedTabs || allTabs.some((tab) => tab.id === activeTab)) return
    const fallback = allTabs[0]?.id
    if (fallback) onTabChange(fallback)
  }, [activeTab, allTabs, isLoadingInjectedTabs, onTabChange])

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

  const measuring = visibleIds === null || allTabs.some((tab) => widthsRef.current.get(tab.id)?.signature !== tabSignature(tab, activeTab))

  // Priority+ navigation: render every tab once to learn its width (before paint), then keep
  // only the tabs that fit beside the More trigger and fold the rest into the menu. jsdom
  // reports zero widths, so it falls back to the fixed PRIMARY_TAB_LIMIT split.
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
          const tab = allTabs[index]
          const width = element.getBoundingClientRect().width
          tabsWidth += width
          if (tab) widthsRef.current.set(tab.id, { width, signature: tabSignature(tab, activeTab) })
        })
        if (moreRef.current) moreWidthRef.current = moreRef.current.getBoundingClientRect().width
        if (tabList) {
          // Padding, borders and anything else the list adds around its tabs.
          const gaps = Math.max(0, rendered.length - 1) * gap
          listChromeRef.current = Math.max(0, tabList.getBoundingClientRect().width - tabsWidth - gaps)
        }
      }
      const available = list.clientWidth - listChromeRef.current - 1
      // Styles can still be settling right after hydration, so a visible strip may have measured
      // its tabs at 0: drop those entries and measure again on the next frame (a few times at most).
      const unmeasured = allTabs.some((tab) => (widthsRef.current.get(tab.id)?.width ?? 0) === 0)
      if (unmeasured && list.clientWidth > 0 && remeasureRetriesRef.current < 5) {
        remeasureRetriesRef.current += 1
        requestAnimationFrame(() => {
          for (const tab of allTabs) {
            if ((widthsRef.current.get(tab.id)?.width ?? 0) === 0) widthsRef.current.delete(tab.id)
          }
          setVisibleIds(null)
        })
        return
      }
      let next: string[]
      if (available <= 0) {
        const inline = allTabs.slice(0, PRIMARY_TAB_LIMIT).map((tab) => tab.id)
        next = inline.includes(activeTab) || !allTabs.some((tab) => tab.id === activeTab) ? inline : [...inline, activeTab]
      } else {
        const widthOf = (id: string) => widthsRef.current.get(id)?.width ?? 0
        const total = allTabs.reduce((sum, tab) => sum + widthOf(tab.id) + gap, 0) - gap
        if (total <= available) {
          next = allTabs.map((tab) => tab.id)
        } else {
          const budget = available - moreWidthRef.current
          let used = 0
          next = []
          for (const tab of allTabs) {
            const width = widthOf(tab.id) + gap
            if (used + width > budget) break
            next.push(tab.id)
            used += width
          }
          if (!next.includes(activeTab) && allTabs.some((tab) => tab.id === activeTab)) {
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
  }, [activeTab, allTabs, measuring])

  const visibleTabs = React.useMemo(() => {
    if (measuring || !visibleIds) return allTabs
    const byId = new Map(allTabs.map((tab) => [tab.id, tab]))
    return visibleIds.map((id) => byId.get(id)).filter((tab): tab is TabDef => Boolean(tab))
  }, [allTabs, measuring, visibleIds])
  const overflowTabs = React.useMemo(() => {
    if (measuring || !visibleIds) return []
    const visible = new Set(visibleIds)
    return allTabs.filter((tab) => !visible.has(tab.id))
  }, [allTabs, measuring, visibleIds])
  const showMore = measuring || overflowTabs.length > 0

  React.useEffect(() => {
    if (!showMore) setMoreOpen(false)
  }, [showMore])

  return (
    <div>
      <div ref={rowRef} className="flex items-end justify-between gap-2 border-b">
        <div ref={listRef} className="flex min-w-0 flex-1 flex-nowrap items-end overflow-hidden">
          <Tabs
            value={activeTab}
            onValueChange={(value) => onTabChange(value as PersonTabId)}
            variant="underline"
            className="shrink-0"
          >
            <TabsList
              aria-label={t('customers.people.detail.tabs.label', 'Person detail sections')}
              className="-mb-px flex-nowrap border-b-0 px-1"
            >
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
                  {t('customers.people.detail.tabs.more', 'More')}
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
                  aria-label={t('customers.people.detail.tabs.more', 'More')}
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

      {/* Two-column content below tabs */}
      <div className="pt-6">
        {children}
      </div>
    </div>
  )
}

registerComponent<PersonDetailTabsProps>({
  id: PERSON_DETAIL_TABS_COMPONENT_ID,
  component: DefaultPersonDetailTabs,
  metadata: {
    module: 'customers',
    description: 'Person detail tab navigation and content.',
  },
})

export function PersonDetailTabs(props: PersonDetailTabsProps) {
  const ResolvedTabs = useRegisteredComponent<PersonDetailTabsProps>(
    PERSON_DETAIL_TABS_COMPONENT_ID,
    DefaultPersonDetailTabs,
  )
  return <ResolvedTabs {...props} />
}
