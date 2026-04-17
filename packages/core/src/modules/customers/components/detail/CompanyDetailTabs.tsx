"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import {
  Users,
  Handshake,
  Clock,
  History,
  Paperclip,
} from 'lucide-react'

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
  badge?: React.ReactNode
}

type CompanyDetailTabsProps = {
  activeTab: CompanyTabId
  onTabChange: (tab: CompanyTabId) => void
  injectedTabs?: Array<{ id: string; label: string; priority?: number }>
  peopleCount?: number
  dealsCount?: number
  activitiesCount?: number
  filesCount?: number
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

function NewBadge() {
  return (
    <span className="ml-1.5 rounded bg-foreground px-1.5 py-0.5 text-overline font-semibold leading-none text-background">
      NEW
    </span>
  )
}

function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium leading-none text-muted-foreground">
      {count > 999 ? '999+' : count}
    </span>
  )
}

export function CompanyDetailTabs({
  activeTab,
  onTabChange,
  injectedTabs = [],
  peopleCount = 0,
  dealsCount = 0,
  activitiesCount = 0,
  filesCount = 0,
  children,
}: CompanyDetailTabsProps) {
  const t = useT()

  const builtInTabs: TabDef[] = React.useMemo(
    () => [
      {
        id: 'people',
        label: t('customers.companies.detail.tabs.people', 'People'),
        icon: <Users className="size-4" />,
        badge: <CountBadge count={peopleCount} />,
      },
      {
        id: 'deals',
        label: t('customers.companies.detail.tabs.deals', 'Deals'),
        icon: <Handshake className="size-4" />,
        badge: <CountBadge count={dealsCount} />,
      },
      {
        id: 'activity-log',
        label: t('customers.companies.detail.tabs.activityLog', 'Activity log'),
        icon: <Clock className="size-4" />,
        badge: <CountBadge count={activitiesCount} />,
      },
      {
        id: 'changelog',
        label: t('customers.companies.detail.tabs.changelog', 'Changelog'),
        icon: <History className="size-4" />,
        badge: <NewBadge />,
      },
      {
        id: 'files',
        label: t('customers.companies.detail.tabs.files', 'Files'),
        icon: <Paperclip className="size-4" />,
        badge: <CountBadge count={filesCount} />,
      },
    ],
    [t, peopleCount, dealsCount, activitiesCount, filesCount],
  )

  const allTabs: TabDef[] = React.useMemo(
    () => [
      ...builtInTabs,
      ...injectedTabs.map((tab) => ({
        id: tab.id as CompanyTabId,
        label: tab.label,
      })),
    ],
    [builtInTabs, injectedTabs],
  )

  return (
    <div>
      {/* Tab navigation */}
      <div className="border-b" role="tablist" aria-label={t('customers.companies.detail.tabs.label', 'Company detail sections')}>
        <nav className="-mb-px flex gap-1 overflow-x-auto px-1">
          {allTabs.map((tab) => {
            const isActive = activeTab === tab.id
            return (
              <Button
                key={tab.id}
                type="button"
                variant="ghost"
                size="sm"
                role="tab"
                aria-selected={isActive}
                onClick={() => onTabChange(tab.id)}
                className={cn(
                  'h-auto shrink-0 rounded-none border-b-2 px-3 py-2.5 hover:bg-transparent',
                  isActive
                    ? 'border-foreground text-foreground font-semibold'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.icon && <span className="mr-1.5">{tab.icon}</span>}
                {tab.label}
                {tab.badge}
              </Button>
            )
          })}
        </nav>
      </div>

      {/* Tab content */}
      <div className="pt-6" role="tabpanel">
        {children}
      </div>
    </div>
  )
}
