"use client"

import * as React from 'react'
import { Activity, Building2, History, NotebookPen, Paperclip, Users } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Tabs, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'

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
  count?: React.ReactNode
}

type DealDetailTabsProps = {
  activeTab: DealTabId
  onTabChange: (tab: DealTabId) => void
  injectedTabs?: Array<{ id: string; label: string }>
  hiddenTabIds?: string[]
  peopleCount?: number
  companiesCount?: number
  children: React.ReactNode
}

const SUPPORTED_TAB_IDS = new Set<DealTabId>(['activities', 'people', 'companies', 'notes', 'files', 'changelog'])

export function resolveLegacyTab(tab: string | null | undefined, knownTabIds?: Iterable<string>): DealTabId {
  if (!tab) return 'activities'
  if (SUPPORTED_TAB_IDS.has(tab as DealTabId)) return tab as DealTabId
  if (knownTabIds && new Set(knownTabIds).has(tab)) return tab
  return 'activities'
}

function formatTabCount(count: number): string | number | undefined {
  if (count <= 0) return undefined
  return count > 999 ? '999+' : count
}

export function DealDetailTabs({
  activeTab,
  onTabChange,
  injectedTabs = [],
  hiddenTabIds = [],
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
        count: formatTabCount(peopleCount),
      },
      {
        id: 'companies',
        label: t('customers.deals.detail.tabs.companies', 'Companies'),
        icon: <Building2 className="size-4" />,
        count: formatTabCount(companiesCount),
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
        count: 'NEW',
      },
    ],
    [companiesCount, peopleCount, t],
  )

  const allTabs = React.useMemo<TabDef[]>(() => {
    const hidden = new Set(hiddenTabIds)
    return [
      ...builtInTabs,
      ...injectedTabs.map((tab) => ({
        id: tab.id as DealTabId,
        label: tab.label,
      })),
    ].filter((tab) => !hidden.has(tab.id))
  }, [builtInTabs, hiddenTabIds, injectedTabs])

  return (
    <div>
      <Tabs
        value={activeTab}
        onValueChange={(value) => onTabChange(value as DealTabId)}
        variant="underline"
      >
        <TabsList
          aria-label={t('customers.deals.detail.tabs.label', 'Deal detail sections')}
          className="w-full overflow-x-auto"
        >
          {allTabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} leading={tab.icon} count={tab.count}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="pt-5" role="tabpanel">
        {children}
      </div>
    </div>
  )
}
