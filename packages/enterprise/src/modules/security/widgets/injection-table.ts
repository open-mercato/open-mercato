import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'security.profile.sections': [{ widgetId: 'security.injection.profile-recent-sign-ins', priority: 500 }],
}

export default injectionTable
