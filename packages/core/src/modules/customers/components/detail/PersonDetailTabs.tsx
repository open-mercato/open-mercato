"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SquareCheckBig, Mail, Briefcase, Building2, Check, History, Paperclip, MapPin } from 'lucide-react'
import type { SectionAction } from '@open-mercato/ui/backend/detail'
import { registerComponent } from '@open-mercato/shared/modules/widgets/component-registry'
import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'
import { resolveInjectedIcon } from '@open-mercato/ui/backend/injection/resolveInjectedIcon'
import { DetailTabRail } from './DetailTabRail'

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
  injectedTabs?: Array<{ id: string; label: string; icon?: string; priority?: number }>
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
        icon: resolveInjectedIcon(tab.icon),
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

  return (
    <DetailTabRail
      busy={isLoadingInjectedTabs}
      tabs={allTabs}
      activeTab={activeTab}
      onTabChange={(tab) => onTabChange(tab as PersonTabId)}
      listLabel={t('customers.people.detail.tabs.label', 'Person detail sections')}
      moreLabel={t('customers.people.detail.tabs.more', 'More')}
      sectionAction={sectionAction}
    >
      {children}
    </DetailTabRail>
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
