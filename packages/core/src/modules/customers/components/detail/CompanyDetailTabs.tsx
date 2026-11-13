"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Users, Handshake, Clock, History, Paperclip } from 'lucide-react'
import type { SectionAction } from '@open-mercato/ui/backend/detail'
import { registerComponent } from '@open-mercato/shared/modules/widgets/component-registry'
import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'
import { resolveInjectedIcon } from '@open-mercato/ui/backend/injection/resolveInjectedIcon'
import { useDealsAccess } from './useDealsAccess'
import { DetailTabRail } from './DetailTabRail'

export const COMPANY_DETAIL_TAB_IDS = ['people', 'deals', 'activity-log', 'changelog', 'files'] as const

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
  priority?: number
}

export const COMPANY_DETAIL_TABS_COMPONENT_ID = 'section:customers.companies.detailTabs'

export type CompanyDetailTabsProps = {
  activeTab: CompanyTabId
  onTabChange: (tab: CompanyTabId) => void
  injectedTabs?: Array<{ id: string; label: string; icon?: string; priority?: number }>
  isLoadingInjectedTabs?: boolean
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

export function resolveLegacyTab(tab: string | null | undefined, knownTabIds?: Iterable<string>): CompanyTabId {
  if (!tab) return 'people'
  if (LEGACY_TAB_MAP[tab]) return LEGACY_TAB_MAP[tab]
  if ((COMPANY_DETAIL_TAB_IDS as readonly string[]).includes(tab) || (knownTabIds && new Set(knownTabIds).has(tab))) return tab
  return 'people'
}

function formatTabCount(count: number): string | number | undefined {
  if (count <= 0) return undefined
  return count > 999 ? '999+' : count
}

function DefaultCompanyDetailTabs({
  activeTab,
  onTabChange,
  injectedTabs = [],
  isLoadingInjectedTabs = false,
  hiddenTabIds = [],
  peopleCount = 0,
  dealsCount = 0,
  activitiesCount = 0,
  filesCount = 0,
  sectionAction = null,
  children,
}: CompanyDetailTabsProps) {
  const t = useT()
  const { canViewDeals, isReady: isDealsAccessReady } = useDealsAccess()

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
      ...injectedTabs.filter((tab, index) => !builtInTabs.some((native) => native.id === tab.id) && injectedTabs.findIndex((candidate) => candidate.id === tab.id) === index).map((tab) => ({
        id: tab.id as CompanyTabId,
        label: tab.label,
        icon: resolveInjectedIcon(tab.icon),
        priority: tab.priority,
      })),
    ]
      .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0))
      .filter((tab) => !hidden.has(tab.id))
  }, [builtInTabs, hiddenTabIds, injectedTabs])

  React.useEffect(() => {
    if (isLoadingInjectedTabs || !isDealsAccessReady || allTabs.some((tab) => tab.id === activeTab)) return
    const fallback = allTabs[0]?.id
    if (fallback) onTabChange(fallback)
  }, [activeTab, allTabs, isLoadingInjectedTabs, onTabChange, isDealsAccessReady])

  return (
    <DetailTabRail
      busy={isLoadingInjectedTabs}
      tabs={allTabs}
      activeTab={activeTab}
      onTabChange={(tab) => onTabChange(tab as CompanyTabId)}
      listLabel={t('customers.companies.detail.tabs.label', 'Company detail sections')}
      moreLabel={t('customers.companies.detail.tabs.more', 'More')}
      sectionAction={sectionAction}
    >
      {children}
    </DetailTabRail>
  )
}

registerComponent<CompanyDetailTabsProps>({
  id: COMPANY_DETAIL_TABS_COMPONENT_ID,
  component: DefaultCompanyDetailTabs,
  metadata: {
    module: 'customers',
    description: 'Company detail tab navigation and content.',
  },
})

export function CompanyDetailTabs(props: CompanyDetailTabsProps) {
  const ResolvedTabs = useRegisteredComponent<CompanyDetailTabsProps>(
    COMPANY_DETAIL_TABS_COMPONENT_ID,
    DefaultCompanyDetailTabs,
  )
  return <ResolvedTabs {...props} />
}
