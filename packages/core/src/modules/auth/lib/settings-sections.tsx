import * as React from 'react'
import type { SectionNavGroup } from '@open-mercato/ui/backend/section-page'

const ServerIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
    <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
    <line x1="6" y1="6" x2="6.01" y2="6" />
    <line x1="6" y1="18" x2="6.01" y2="18" />
  </svg>
)

const DatabaseIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
  </svg>
)

const WorkflowIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="6" height="6" rx="1" />
    <rect x="15" y="3" width="6" height="6" rx="1" />
    <rect x="9" y="15" width="6" height="6" rx="1" />
    <path d="M6 9v3a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9" />
    <path d="M12 13v2" />
  </svg>
)

const ShieldIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
)

const UsersIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
)

const KeyIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
  </svg>
)

const ToggleIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="5" width="22" height="14" rx="7" ry="7" />
    <circle cx="16" cy="12" r="3" />
  </svg>
)

const BuildingIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
    <path d="M9 22v-4h6v4" />
    <path d="M8 6h.01" />
    <path d="M16 6h.01" />
    <path d="M12 6h.01" />
    <path d="M12 10h.01" />
    <path d="M12 14h.01" />
    <path d="M16 10h.01" />
    <path d="M16 14h.01" />
    <path d="M8 10h.01" />
    <path d="M8 14h.01" />
  </svg>
)

const RulesIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <path d="M16 13H8" />
    <path d="M16 17H8" />
    <path d="M10 9H8" />
  </svg>
)

const SettingsIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

const LockIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
)

export const settingsSections: SectionNavGroup[] = [
  {
    id: 'system',
    label: 'System',
    labelKey: 'settings.sections.system',
    order: 1,
    items: [
      {
        id: 'system-status',
        label: 'System Status',
        labelKey: 'configs.config.nav.systemStatus',
        href: '/backend/config/system-status',
        icon: ServerIcon,
        requireFeatures: ['configs.system_status.view'],
        order: 1,
      },
      {
        id: 'cache',
        label: 'Cache',
        labelKey: 'configs.config.nav.cache',
        href: '/backend/config/cache',
        icon: ServerIcon,
        requireFeatures: ['configs.cache.view'],
        order: 2,
      },
    ],
  },
  {
    id: 'auth',
    label: 'Auth',
    labelKey: 'settings.sections.auth',
    order: 2,
    items: [
      {
        id: 'users',
        label: 'Users',
        labelKey: 'auth.nav.users',
        href: '/backend/users',
        icon: UsersIcon,
        requireFeatures: ['users.view'],
        order: 1,
      },
      {
        id: 'roles',
        label: 'Roles',
        labelKey: 'auth.nav.roles',
        href: '/backend/roles',
        icon: ShieldIcon,
        requireFeatures: ['roles.view'],
        order: 2,
      },
      {
        id: 'api-keys',
        label: 'API Keys',
        labelKey: 'api_keys.nav.apiKeys',
        href: '/backend/api-keys',
        icon: KeyIcon,
        requireFeatures: ['api_keys.view'],
        order: 3,
      },
    ],
  },
  {
    id: 'data-designer',
    label: 'Data Designer',
    labelKey: 'settings.sections.dataDesigner',
    order: 4,
    items: [
      {
        id: 'system-entities',
        label: 'System Entities',
        labelKey: 'entities.nav.systemEntities',
        href: '/backend/entities/system',
        icon: DatabaseIcon,
        requireFeatures: ['entities.definitions.view'],
        order: 1,
      },
      {
        id: 'user-entities',
        label: 'User Entities',
        labelKey: 'entities.nav.userEntities',
        href: '/backend/entities/user',
        icon: DatabaseIcon,
        requireFeatures: ['entities.definitions.view'],
        order: 2,
      },
      {
        id: 'query-indexes',
        label: 'Query Indexes',
        labelKey: 'query_index.nav.queryIndexes',
        href: '/backend/query-indexes',
        icon: DatabaseIcon,
        requireFeatures: ['query_index.status.view'],
        order: 3,
      },
    ],
  },
  {
    id: 'workflows',
    label: 'Workflows',
    labelKey: 'settings.sections.workflows',
    order: 5,
    items: [
      {
        id: 'workflow-definitions',
        label: 'Definitions',
        labelKey: 'workflows.nav.definitions',
        href: '/backend/definitions',
        icon: WorkflowIcon,
        requireFeatures: ['workflows.view'],
        order: 1,
      },
      {
        id: 'workflow-instances',
        label: 'Instances',
        labelKey: 'workflows.nav.instances',
        href: '/backend/instances',
        icon: WorkflowIcon,
        requireFeatures: ['workflows.view_instances'],
        order: 2,
      },
      {
        id: 'workflow-tasks',
        label: 'Tasks',
        labelKey: 'workflows.nav.tasks',
        href: '/backend/tasks',
        icon: WorkflowIcon,
        requireFeatures: ['workflows.view_tasks'],
        order: 3,
      },
      {
        id: 'workflow-events',
        label: 'Events',
        labelKey: 'workflows.nav.events',
        href: '/backend/events',
        icon: WorkflowIcon,
        requireFeatures: ['workflows.view_logs'],
        order: 4,
      },
    ],
  },
  {
    id: 'business-rules',
    label: 'Business Rules',
    labelKey: 'settings.sections.businessRules',
    order: 3,
    items: [
      {
        id: 'rules',
        label: 'Rules',
        labelKey: 'business_rules.nav.rules',
        href: '/backend/rules',
        icon: RulesIcon,
        requireFeatures: ['business_rules.view'],
        order: 1,
      },
      {
        id: 'rule-sets',
        label: 'Rule Sets',
        labelKey: 'business_rules.nav.rule_sets',
        href: '/backend/sets',
        icon: RulesIcon,
        requireFeatures: ['business_rules.view'],
        order: 2,
      },
      {
        id: 'rule-logs',
        label: 'Execution Logs',
        labelKey: 'business_rules.nav.execution_logs',
        href: '/backend/logs',
        icon: RulesIcon,
        requireFeatures: ['business_rules.view_logs'],
        order: 3,
      },
    ],
  },
  {
    id: 'module-configs',
    label: 'Module Configs',
    labelKey: 'settings.sections.moduleConfigs',
    order: 6,
    items: [
      {
        id: 'sales-config',
        label: 'Sales',
        labelKey: 'sales.config.nav.sales',
        href: '/backend/config/sales',
        icon: SettingsIcon,
        requireFeatures: ['sales.settings.manage'],
        order: 1,
      },
      {
        id: 'catalog-config',
        label: 'Catalog',
        labelKey: 'catalog.config.nav.catalog',
        href: '/backend/config/catalog',
        icon: SettingsIcon,
        requireFeatures: ['catalog.settings.manage'],
        order: 2,
      },
      {
        id: 'customers-config',
        label: 'Customers',
        labelKey: 'customers.config.nav.customers',
        href: '/backend/config/customers',
        icon: SettingsIcon,
        requireFeatures: ['customers.settings.manage'],
        order: 3,
      },
      {
        id: 'currencies-config',
        label: 'Currencies',
        labelKey: 'currencies.fetch.title',
        href: '/backend/config/currency-fetching',
        icon: SettingsIcon,
        requireFeatures: ['currencies.fetch.view'],
        order: 4,
      },
      {
        id: 'dictionaries-config',
        label: 'Dictionaries',
        labelKey: 'dictionaries.config.nav.title',
        href: '/backend/config/dictionaries',
        icon: SettingsIcon,
        requireFeatures: ['dictionaries.manage'],
        order: 5,
      },
      {
        id: 'encryption-config',
        label: 'Encryption',
        labelKey: 'entities.encryption.title',
        href: '/backend/config/encryption',
        icon: LockIcon,
        requireFeatures: ['entities.definitions.manage'],
        order: 6,
      },
    ],
  },
  {
    id: 'directory',
    label: 'Directory',
    labelKey: 'settings.sections.directory',
    order: 7,
    items: [
      {
        id: 'organizations',
        label: 'Organizations',
        labelKey: 'directory.nav.organizations',
        href: '/backend/directory/organizations',
        icon: BuildingIcon,
        requireFeatures: ['directory.organizations.view'],
        order: 1,
      },
      {
        id: 'tenants',
        label: 'Tenants',
        labelKey: 'directory.nav.tenants',
        href: '/backend/directory/tenants',
        icon: BuildingIcon,
        requireFeatures: ['directory.tenants.view'],
        order: 2,
      },
    ],
  },
  {
    id: 'feature-toggles',
    label: 'Feature Toggles',
    labelKey: 'settings.sections.featureToggles',
    order: 8,
    items: [
      {
        id: 'global-toggles',
        label: 'Global',
        labelKey: 'feature_toggles.nav.global',
        href: '/backend/feature-toggles/global',
        icon: ToggleIcon,
        requireFeatures: ['feature_toggles.view'],
        order: 1,
      },
      {
        id: 'toggle-overrides',
        label: 'Overrides',
        labelKey: 'feature_toggles.nav.overrides',
        href: '/backend/feature-toggles/overrides',
        icon: ToggleIcon,
        requireFeatures: ['feature_toggles.view'],
        order: 2,
      },
    ],
  },
]

export const settingsRequiredFeatures = (() => {
  const features: string[] = []
  for (const section of settingsSections) {
    for (const item of section.items) {
      if (item.requireFeatures) {
        features.push(...item.requireFeatures)
      }
    }
  }
  return [...new Set(features)]
})()

export const settingsPathPrefixes = [
  '/backend/config/',
  '/backend/users',
  '/backend/roles',
  '/backend/api-keys',
  '/backend/entities/',
  '/backend/query-indexes',
  '/backend/definitions',
  '/backend/instances',
  '/backend/tasks',
  '/backend/events',
  '/backend/rules',
  '/backend/sets',
  '/backend/logs',
  '/backend/directory/',
  '/backend/feature-toggles/',
]

export function isSettingsPath(path: string): boolean {
  if (path === '/backend/settings') return true
  return settingsPathPrefixes.some((prefix) => path.startsWith(prefix))
}
