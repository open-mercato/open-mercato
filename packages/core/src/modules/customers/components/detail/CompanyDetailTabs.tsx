"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tabs, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import {
  Users,
  Handshake,
  Clock,
  History,
  Paperclip,
  Plus,
} from 'lucide-react'
import type { SectionAction } from '@open-mercato/ui/backend/detail'
import { useDealsAccess } from './useDealsAccess'

export type CompanyTabId =
  | 'people'
  | 'deals'
  | 'activity-log'
  | 'changelog'
  | 'files'
  | string

type TabDef = {
  id: CompanyTabId
  label: string
  icon?: React.ReactNode
  count?: React.ReactNode
}

type CompanyDetailTabsProps = {
  activeTab: CompanyTabId
  onTabChange: (tab: CompanyTabId) => void
  injectedTabs?: Array<{ id: string; label: string; priority?: number }>
  hiddenTabIds?: string[]
  peopleCount?: number
  dealsCount?: number
  activitiesCount?: number
  filesCount?: number
  sectionAction?: SectionAction | null
  children: React.ReactNode
}

const LEGACY_TAB_MAP: Record<string, CompanyTabId> = {
  notes: 'people',
  activities: 'activity-log',
  addresses: 'people',
  tasks: 'people',
  dashboard: 'people',
  'dane-firmy': 'people',
  analysis: 'people',
}

export function resolveLegacyTab(tab: string | null | undefined): CompanyTabId {
  if (!tab) return 'people'
  if (LEGACY_TAB_MAP[tab]) return LEGACY_TAB_MAP[tab]
  return tab as CompanyTabId
}

function formatTabCount(count: number): string | number | undefined {
  if (count <= 0) return undefined
  return count > 999 ? '999+' : count
}

export function CompanyDetailTabs({
  activeTab,
  onTabChange,
  injectedTabs = [],
  hiddenTabIds = [],
  peopleCount = 0,
  dealsCount = 0,
  activitiesCount = 0,
  filesCount = 0,
  sectionAction = null,
  children,
}: CompanyDetailTabsProps) {
  const t = useT()
  const { canViewDeals } = useDealsAccess()

  const builtInTabs: TabDef[] = React.useMemo(
    () => [
      {
        id: 'people',
        label: t('customers.companies.detail.tabs.people', 'People'),
        icon: <Users className="size-4" />,
        count: formatTabCount(peopleCount),
      },
      ...(canViewDeals
        ? [
            {
              id: 'deals' as CompanyTabId,
              label: t('customers.companies.detail.tabs.deals', 'Deals'),
              icon: <Handshake className="size-4" />,
              count: formatTabCount(dealsCount),
            },
          ]
        : []),
      {
        id: 'activity-log',
        label: t('customers.companies.detail.tabs.activityLog', 'Activity log'),
        icon: <Clock className="size-4" />,
        count: formatTabCount(activitiesCount),
      },
      {
        id: 'changelog',
        label: t('customers.companies.detail.tabs.changelog', 'Changelog'),
        icon: <History className="size-4" />,
        count: 'NEW',
      },
      {
        id: 'files',
        label: t('customers.companies.detail.tabs.files', 'Files'),
        icon: <Paperclip className="size-4" />,
        count: formatTabCount(filesCount),
      },
    ],
    [t, canViewDeals, peopleCount, dealsCount, activitiesCount, filesCount],
  )

  const allTabs: TabDef[] = React.useMemo(() => {
    const hidden = new Set(hiddenTabIds)
    return [
      ...builtInTabs,
      ...injectedTabs.map((tab) => ({
        id: tab.id as CompanyTabId,
        label: tab.label,
      })),
    ].filter((tab) => !hidden.has(tab.id))
  }, [builtInTabs, hiddenTabIds, injectedTabs])

  return (
    <div>
      {/* Tab navigation */}
      <div className="flex items-end justify-between gap-2 border-b">
        <Tabs
          value={activeTab}
          onValueChange={(value) => onTabChange(value as CompanyTabId)}
          variant="underline"
          className="min-w-0 flex-1"
        >
          <TabsList
            aria-label={t('customers.companies.detail.tabs.label', 'Company detail sections')}
            className="-mb-px w-full overflow-x-auto border-b-0 px-1"
          >
            {allTabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} leading={tab.icon} count={tab.count}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {sectionAction ? (
          <Button
            type="button"
            size="sm"
            onClick={sectionAction.onClick}
            disabled={sectionAction.disabled}
            className="mb-1.5 mr-1 shrink-0"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {sectionAction.label}
          </Button>
        ) : null}
      </div>

      {/* Tab content */}
      <div className="pt-6" role="tabpanel">
        {children}
      </div>
    </div>
  )
}
