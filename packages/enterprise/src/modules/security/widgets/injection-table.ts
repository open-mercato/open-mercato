import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'menu:topbar:profile-dropdown': [
    {
      widgetId: 'security.injection.profile-dropdown-security-item',
      kind: 'stack',
      priority: 500,
    },
  ],
  'menu:sidebar:profile': [
    {
      widgetId: 'security.injection.profile-sidebar-security-item',
      kind: 'stack',
      priority: 500,
    },
  ],
}

export default injectionTable
