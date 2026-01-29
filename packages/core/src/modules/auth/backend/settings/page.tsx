'use client'
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { SettingsNavigation, type SettingsSection } from '@open-mercato/ui/backend/settings'

type FeatureCheckResponse = { ok?: boolean; granted?: string[] }

const ServerIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
    <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
    <line x1="6" y1="6" x2="6.01" y2="6" />
    <line x1="6" y1="18" x2="6.01" y2="18" />
  </svg>
)

const DatabaseIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
  </svg>
)

const WorkflowIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="6" height="6" rx="1" />
    <rect x="15" y="3" width="6" height="6" rx="1" />
    <rect x="9" y="15" width="6" height="6" rx="1" />
    <path d="M6 9v3a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9" />
    <path d="M12 13v2" />
  </svg>
)

const ShieldIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
)

// Define sections outside component to avoid recreation on each render
const sections: SettingsSection[] = [
  {
    id: 'system',
    titleKey: 'settings.sections.system',
    title: 'System Settings',
    cards: [
      {
        id: 'cache',
        titleKey: 'configs.config.nav.cache',
        title: 'Cache',
        descriptionKey: 'settings.cards.cache.description',
        description: 'Manage application cache settings and clear cached data',
        href: '/backend/config/cache',
        icon: ServerIcon,
        requireFeatures: ['configs.cache.view'],
      },
      {
        id: 'system-status',
        titleKey: 'configs.config.nav.systemStatus',
        title: 'System Status',
        descriptionKey: 'settings.cards.systemStatus.description',
        description: 'View system health and status information',
        href: '/backend/config/system-status',
        icon: ServerIcon,
        requireFeatures: ['configs.system_status.view'],
      },
    ],
  },
  {
    id: 'data-designer',
    titleKey: 'settings.sections.dataDesigner',
    title: 'Data Designer',
    cards: [
      {
        id: 'encryption',
        titleKey: 'entities.nav.encryption',
        title: 'Encryption',
        descriptionKey: 'settings.cards.encryption.description',
        description: 'Configure data encryption settings',
        href: '/backend/config/encryption',
        icon: ShieldIcon,
        requireFeatures: ['entities.definitions.manage'],
      },
      {
        id: 'system-entities',
        titleKey: 'entities.nav.systemEntities',
        title: 'System Entities',
        descriptionKey: 'settings.cards.systemEntities.description',
        description: 'View and manage system entity definitions',
        href: '/backend/entities/system',
        icon: DatabaseIcon,
        requireFeatures: ['entities.definitions.view'],
      },
      {
        id: 'user-entities',
        titleKey: 'entities.nav.userEntities',
        title: 'User Entities',
        descriptionKey: 'settings.cards.userEntities.description',
        description: 'Create and manage custom entities',
        href: '/backend/entities/user',
        icon: DatabaseIcon,
        requireFeatures: ['entities.definitions.view'],
      },
      {
        id: 'query-indexes',
        titleKey: 'query_index.nav.queryIndexes',
        title: 'Query Indexes',
        descriptionKey: 'settings.cards.queryIndexes.description',
        description: 'Manage query indexes for optimized data retrieval',
        href: '/backend/query-indexes',
        icon: DatabaseIcon,
        requireFeatures: ['query_index.status.view'],
      },
    ],
  },
  {
    id: 'workflows',
    titleKey: 'settings.sections.workflows',
    title: 'Workflow Engine',
    cards: [
      {
        id: 'workflow-definitions',
        titleKey: 'workflows.nav.definitions',
        title: 'Definitions',
        descriptionKey: 'settings.cards.workflowDefinitions.description',
        description: 'Create and manage workflow definitions',
        href: '/backend/workflows/definitions',
        icon: WorkflowIcon,
        requireFeatures: ['workflows.view'],
      },
      {
        id: 'workflow-instances',
        titleKey: 'workflows.nav.instances',
        title: 'Instances',
        descriptionKey: 'settings.cards.workflowInstances.description',
        description: 'View and manage running workflow instances',
        href: '/backend/workflows/instances',
        icon: WorkflowIcon,
        requireFeatures: ['workflows.view_instances'],
      },
      {
        id: 'workflow-tasks',
        titleKey: 'workflows.nav.tasks',
        title: 'Tasks',
        descriptionKey: 'settings.cards.workflowTasks.description',
        description: 'Manage workflow tasks and assignments',
        href: '/backend/workflows/tasks',
        icon: WorkflowIcon,
        requireFeatures: ['workflows.view_tasks'],
      },
      {
        id: 'workflow-events',
        titleKey: 'workflows.nav.events',
        title: 'Events',
        descriptionKey: 'settings.cards.workflowEvents.description',
        description: 'View workflow event history',
        href: '/backend/workflows/events',
        icon: WorkflowIcon,
        requireFeatures: ['workflows.view_logs'],
      },
    ],
  },
]

// Pre-compute all required features (static, defined at module level)
const allRequiredFeatures = (() => {
  const features: string[] = []
  for (const section of sections) {
    for (const card of section.cards) {
      if (card.requireFeatures) {
        features.push(...card.requireFeatures)
      }
    }
  }
  return [...new Set(features)]
})()

export default function SettingsHubPage() {
  const t = useT()
  const [userFeatures, setUserFeatures] = React.useState<Set<string> | undefined>(undefined)
  const [loading, setLoading] = React.useState(true)

  // Fetch user features on mount
  React.useEffect(() => {
    let cancelled = false
    async function loadFeatures() {
      if (allRequiredFeatures.length === 0) {
        setUserFeatures(new Set())
        setLoading(false)
        return
      }
      try {
        const call = await apiCall<FeatureCheckResponse>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: allRequiredFeatures }),
        })
        if (cancelled) return
        if (call.ok && Array.isArray(call.result?.granted)) {
          setUserFeatures(new Set(call.result.granted))
        } else {
          setUserFeatures(new Set())
        }
      } catch {
        if (!cancelled) setUserFeatures(new Set())
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadFeatures()
    return () => {
      cancelled = true
    }
  }, []) // allRequiredFeatures is a module-level constant, no deps needed

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{t('settings.page.title', 'Settings')}</h1>
        <p className="text-muted-foreground">
          {t('settings.page.description', 'System configuration and administration')}
        </p>
      </div>

      {loading ? (
        <div className="text-muted-foreground">{t('common.loading', 'Loading...')}</div>
      ) : (
        <SettingsNavigation sections={sections} userFeatures={userFeatures} />
      )}
    </div>
  )
}
