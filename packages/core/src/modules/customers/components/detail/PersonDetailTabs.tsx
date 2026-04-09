"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  User,
  SquareCheckBig,
  Briefcase,
  Building2,
  Check,
  Paperclip,
  SquarePen,
} from 'lucide-react'

export type PersonTabId =
  | 'personalData'
  | 'activities'
  | 'deals'
  | 'companies'
  | 'tasks'
  | 'files'
  | string

type TabDef = {
  id: PersonTabId
  label: string
  icon?: React.ReactNode
  badge?: React.ReactNode
}

type PersonDetailTabsProps = {
  activeTab: PersonTabId
  onTabChange: (tab: PersonTabId) => void
  injectedTabs?: Array<{ id: string; label: string }>
  activitiesCount?: number
  dealsCount?: number
  companiesCount?: number
  tasksCount?: number
  filesCount?: number
  children: React.ReactNode
}

function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">
      {count > 999 ? '999+' : count}
    </span>
  )
}

export function PersonDetailTabs({
  activeTab,
  onTabChange,
  injectedTabs = [],
  activitiesCount = 0,
  dealsCount = 0,
  companiesCount = 0,
  tasksCount = 0,
  filesCount = 0,
  children,
}: PersonDetailTabsProps) {
  const t = useT()

  const builtInTabs: TabDef[] = React.useMemo(
    () => [
      {
        id: 'personalData',
        label: t('customers.people.detail.tabs.personalData', 'Personal data'),
        icon: <User className="size-4" />,
      },
      {
        id: 'activities',
        label: t('customers.people.detail.tabs.activities', 'Activities'),
        icon: <SquareCheckBig className="size-4" />,
        badge: <CountBadge count={activitiesCount} />,
      },
      {
        id: 'deals',
        label: t('customers.people.detail.tabs.deals', 'Deals'),
        icon: <Briefcase className="size-4" />,
        badge: <CountBadge count={dealsCount} />,
      },
      {
        id: 'companies',
        label: t('customers.people.detail.tabs.companies', 'Companies'),
        icon: <Building2 className="size-4" />,
        badge: <CountBadge count={companiesCount} />,
      },
      {
        id: 'tasks',
        label: t('customers.people.detail.tabs.tasks', 'Tasks'),
        icon: <Check className="size-4" />,
        badge: <CountBadge count={tasksCount} />,
      },
      {
        id: 'files',
        label: t('customers.people.detail.tabs.files', 'Files'),
        icon: <Paperclip className="size-4" />,
        badge: <CountBadge count={filesCount} />,
      },
    ],
    [t, activitiesCount, dealsCount, companiesCount, tasksCount, filesCount],
  )

  const allTabs: TabDef[] = React.useMemo(
    () => [
      ...builtInTabs,
      ...injectedTabs.map((tab) => ({
        id: tab.id as PersonTabId,
        label: tab.label,
      })),
    ],
    [builtInTabs, injectedTabs],
  )

  return (
    <div>
      {/* Tab navigation — full width above both zones */}
      <div className="border-b" role="tablist" aria-label={t('customers.people.detail.tabs.label', 'Person detail sections')}>
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

      {/* Two-column content below tabs */}
      <div className="pt-6">
        {children}
      </div>
    </div>
  )
}
