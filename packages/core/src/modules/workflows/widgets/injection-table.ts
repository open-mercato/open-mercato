import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Workflows module injection table
 * Maps injection spot IDs to widget IDs for automatic widget injection
 */
export const injectionTable: ModuleInjectionTable = {
  // Inject the order approval widget into the sales order detail page
  'sales.document.detail.order:details': [
    {
      widgetId: 'workflows.injection.order-approval',
      kind: 'group',
      column: 2,
      groupLabel: 'workflows.orderApproval.groupLabel',
      groupDescription: 'workflows.orderApproval.groupDescription',
      priority: 200,
    },
  ],
}

export default injectionTable
