import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'
import { syncXeroDetailWidgetSpotId } from '../integration'
import { XERO_CONNECT_TAB_ID } from '../lib/constants'

export const XERO_TAB_WIDGET_ID = 'sync_xero.injection.xero-tab'
export const XERO_COMPANY_BADGE_WIDGET_ID = 'sync_xero.injection.company-badge'
export const COMPANY_STATUS_BADGES_SPOT_ID = 'detail:customers.company:status-badges'

export const injectionTable: ModuleInjectionTable = {
  [syncXeroDetailWidgetSpotId]: [
    {
      widgetId: XERO_TAB_WIDGET_ID,
      kind: 'tab',
      groupId: XERO_CONNECT_TAB_ID,
      groupLabel: 'sync_xero.tab.title',
      priority: 100,
    },
  ],
  [COMPANY_STATUS_BADGES_SPOT_ID]: [{ widgetId: XERO_COMPANY_BADGE_WIDGET_ID, priority: 100 }],
}

export default injectionTable
