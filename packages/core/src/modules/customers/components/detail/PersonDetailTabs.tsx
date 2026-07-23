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
  Paperclip,
  Plus,
  MapPin,
} from 'lucide-react'
import type { SectionAction } from '@open-mercato/ui/backend/detail'

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
}

type PersonDetailTabsProps = {
  activeTab: PersonTabId
  onTabChange: (tab: PersonTabId) => void
  injectedTabs?: Array<{ id: string; label: string }>
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

const SUPPORTED_TAB_IDS = new Set<PersonTabId>(['activities', 'emails', 'deals', 'companies', 'addresses', 'tasks', 'changelog', 'files'])

export function resolveLegacyTab(tab: string | null | undefined, knownTabIds?: Iterable<string>): PersonTabId {
  if (!tab) return 'activities'
  if (SUPPORTED_TAB_IDS.has(tab as PersonTabId)) return tab as PersonTabId
  if (knownTabIds && new Set(knownTabIds).has(tab)) return tab
  return 'activities'
}

function formatTabCount(count: number): string | number | undefined {
  if (count <= 0) return undefined
  return count > 999 ? '999+' : count
}

export function PersonDetailTabs({
  activeTab,
  onTabChange,
  injectedTabs = [],
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
        id: 'addresses',
        label: t('customers.people.detail.tabs.addresses', 'Addresses'),
        icon: <MapPin className="size-4" />,
        count: formatTabCount(addressesCount),
      },
      {
        id: 'tasks',
        label: t('customers.people.detail.tabs.tasks', 'Tasks'),
        icon: <Check className="size-4" />,
        count: formatTabCount(tasksCount),
      },
      {
        id: 'changelog',
        label: t('customers.people.detail.tabs.changelog', 'Change log'),
        icon: <History className="size-4" />,
        count: 'NEW',
      },
      {
        id: 'files',
        label: t('customers.people.detail.tabs.files', 'Files'),
        icon: <Paperclip className="size-4" />,
        count: formatTabCount(filesCount),
      },
    ],
    [t, activitiesCount, dealsCount, companiesCount, addressesCount, tasksCount, filesCount],
  )

  const allTabs: TabDef[] = React.useMemo(() => {
    const hidden = new Set(hiddenTabIds)
    return [
      ...builtInTabs,
      ...injectedTabs.map((tab) => ({
        id: tab.id as PersonTabId,
        label: tab.label,
      })),
    ].filter((tab) => !hidden.has(tab.id))
  }, [builtInTabs, hiddenTabIds, injectedTabs])

  return (
    <div>
      {/* Tab navigation — full width above both zones */}
      <div className="flex items-end justify-between gap-2 border-b">
        <Tabs
          value={activeTab}
          onValueChange={(value) => onTabChange(value as PersonTabId)}
          variant="underline"
          className="min-w-0 flex-1"
        >
          <TabsList
            aria-label={t('customers.people.detail.tabs.label', 'Person detail sections')}
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

      {/* Two-column content below tabs */}
      <div className="pt-6">
        {children}
      </div>
    </div>
  )
}
