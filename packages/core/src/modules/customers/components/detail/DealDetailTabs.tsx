"use client"

import * as React from 'react'
import { Activity, Building2, History, NotebookPen, Paperclip, Users } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type DealTabId =
  | 'activities'
  | 'people'
  | 'companies'
  | 'notes'
  | 'files'
  | 'changelog'
  | string

type TabDef = {
  id: DealTabId
  label: string
  icon?: React.ReactNode
  badge?: React.ReactNode
}

type DealDetailTabsProps = {
  activeTab: DealTabId
  onTabChange: (tab: DealTabId) => void
  injectedTabs?: Array<{ id: string; label: string }>
  peopleCount?: number
  companiesCount?: number
  children: React.ReactNode
}

const SUPPORTED_TAB_IDS = new Set<DealTabId>(['activities', 'people', 'companies', 'notes', 'files', 'changelog'])

export function resolveLegacyTab(tab: string | null | undefined): DealTabId {
  if (!tab) return 'activities'
  return SUPPORTED_TAB_IDS.has(tab as DealTabId) ? (tab as DealTabId) : 'activities'
}

function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span className="ml-1.5 rounded-[3px] bg-muted px-[6px] py-[1px] text-xs font-semibold leading-none text-muted-foreground">
      {count > 999 ? '999+' : count}
    </span>
  )
}

function NewBadge() {
  return (
    <span className="ml-1.5 rounded-[3px] bg-muted px-[6px] py-[1px] text-xs font-semibold leading-none text-muted-foreground">
      NEW
    </span>
  )
}

export function DealDetailTabs({
  activeTab,
  onTabChange,
  injectedTabs = [],
  peopleCount = 0,
  companiesCount = 0,
  children,
}: DealDetailTabsProps) {
  const t = useT()

  const builtInTabs = React.useMemo<TabDef[]>(
    () => [
      {
        id: 'activities',
        label: t('customers.deals.detail.tabs.activities', 'Activities'),
        icon: <Activity className="size-4" />,
      },
      {
        id: 'people',
        label: t('customers.deals.detail.tabs.people', 'People'),
        icon: <Users className="size-4" />,
        badge: <CountBadge count={peopleCount} />,
      },
      {
        id: 'companies',
        label: t('customers.deals.detail.tabs.companies', 'Companies'),
        icon: <Building2 className="size-4" />,
        badge: <CountBadge count={companiesCount} />,
      },
      {
        id: 'notes',
        label: t('customers.deals.detail.tabs.notes', 'Notes'),
        icon: <NotebookPen className="size-4" />,
      },
      {
        id: 'files',
        label: t('customers.deals.detail.tabs.files', 'Files'),
        icon: <Paperclip className="size-4" />,
      },
      {
        id: 'changelog',
        label: t('customers.deals.detail.tabs.changelog', 'Changelog'),
        icon: <History className="size-4" />,
        badge: <NewBadge />,
      },
    ],
    [companiesCount, peopleCount, t],
  )

  const allTabs = React.useMemo<TabDef[]>(
    () => [
      ...builtInTabs,
      ...injectedTabs.map((tab) => ({
        id: tab.id as DealTabId,
        label: tab.label,
      })),
    ],
    [builtInTabs, injectedTabs],
  )

  return (
    <div>
      <div className="border-b border-border" role="tablist" aria-label={t('customers.deals.detail.tabs.label', 'Deal detail sections')}>
        <nav className="-mb-px flex gap-7 overflow-x-auto" role="presentation">
          {allTabs.map((tab) => {
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onTabChange(tab.id)}
                className={cn(
                  'inline-flex h-10 shrink-0 items-center border-b-2 pb-3 pt-1 text-sm transition-colors',
                  isActive
                    ? 'border-foreground font-semibold text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.icon ? <span className="mr-1.5">{tab.icon}</span> : null}
                {tab.label}
                {tab.badge}
              </button>
            )
          })}
        </nav>
      </div>

      <div className="pt-5" role="tabpanel">
        {children}
      </div>
    </div>
  )
}
