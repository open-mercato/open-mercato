import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'
import { gusRegonDetailWidgetSpotId } from '../integration'

const companyLookup = {
  widgetId: 'gus_regon.injection.company-lookup',
  kind: 'stack' as const,
  priority: 50,
}

/**
 * `crud-form:customers.company` — the public `companyForm` extension host of the
 * customers module (company create and edit forms). The lookup is stacked above
 * the form fields rather than rendered as a group card, so it sits where the
 * operator starts typing. The integration detail spot carries the status line
 * of the CRM company card on Settings → Integrations → GUS REGON.
 */
export const injectionTable: ModuleInjectionTable = {
  [gusRegonDetailWidgetSpotId]: [{ widgetId: 'gus_regon.injection.integration-status', kind: 'stack', priority: 100 }],
  'crud-form:customers.company': [companyLookup],
}

export default injectionTable
