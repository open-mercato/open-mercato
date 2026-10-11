import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * The field explain widgets are registered per CrudForm spot, never on a global `crud-form:*`
 * pattern: one header switch and one `field:*:after` pattern for each form entity id declared in
 * `formEntityIds` by an `insights.explain.ts` resource with explainable fields (the customers deal,
 * person and company forms). Injection tables are static, so a new form entity id is added here
 * too; `widgets/injection/__tests__/fieldExplainRegistration.test.ts` keeps both lists in sync.
 */
export const injectionTable: ModuleInjectionTable = {
  'backend:record:current': [
    {
      widgetId: 'insights.injection.record-why',
      kind: 'stack',
      priority: 100,
    },
  ],
  'version-history:entry:after': [
    {
      widgetId: 'insights.injection.log-cause',
      kind: 'stack',
      priority: 100,
    },
  ],
  'backend:access-denied:after': [
    {
      widgetId: 'insights.injection.access-why',
      kind: 'stack',
      priority: 100,
    },
  ],
  'detail:customers.deal:status-badges': [
    {
      widgetId: 'insights.injection.deal-status-why',
      kind: 'stack',
      priority: 100,
    },
  ],
  'crud-form:customers.deal:header': [
    {
      widgetId: 'insights.injection.field-explain-toggle',
      kind: 'stack',
      priority: 100,
    },
  ],
  'crud-form:customers.deal:field:*:after': [
    {
      widgetId: 'insights.injection.field-why',
      kind: 'stack',
      priority: 100,
    },
  ],
  'crud-form:customers.customer_deal:header': [
    {
      widgetId: 'insights.injection.field-explain-toggle',
      kind: 'stack',
      priority: 100,
    },
  ],
  'crud-form:customers.customer_deal:field:*:after': [
    {
      widgetId: 'insights.injection.field-why',
      kind: 'stack',
      priority: 100,
    },
  ],
  'crud-form:customers.person:header': [
    {
      widgetId: 'insights.injection.field-explain-toggle',
      kind: 'stack',
      priority: 100,
    },
  ],
  'crud-form:customers.person:field:*:after': [
    {
      widgetId: 'insights.injection.field-why',
      kind: 'stack',
      priority: 100,
    },
  ],
  'crud-form:customers.company:header': [
    {
      widgetId: 'insights.injection.field-explain-toggle',
      kind: 'stack',
      priority: 100,
    },
  ],
  'crud-form:customers.company:field:*:after': [
    {
      widgetId: 'insights.injection.field-why',
      kind: 'stack',
      priority: 100,
    },
  ],
  'crud-form:business_rules.rule:header': [
    {
      widgetId: 'insights.injection.rule-simulate',
      kind: 'stack',
      priority: 100,
    },
  ],
  'crud-form:business_rules.rule': [
    {
      widgetId: 'insights.injection.rule-simulation-apply',
      kind: 'stack',
      priority: 100,
    },
  ],
  'workflows.definition.editor:toolbar': [
    {
      widgetId: 'insights.injection.workflow-simulate',
      kind: 'stack',
      priority: 100,
    },
  ],
  'workflows.definition.editor:banner': [
    {
      widgetId: 'insights.injection.workflow-simulation-apply',
      kind: 'stack',
      priority: 100,
    },
  ],
  'auth.role.acl:toolbar': [
    {
      widgetId: 'insights.injection.role-acl-simulate',
      kind: 'stack',
      priority: 100,
    },
  ],
  'auth.role.acl:banner': [
    {
      widgetId: 'insights.injection.role-acl-simulation-apply',
      kind: 'stack',
      priority: 100,
    },
  ],
}

export default injectionTable
