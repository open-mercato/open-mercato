/**
 * Injection spot of the business rule create and edit forms (`CrudForm` `injectionSpotId`): widgets
 * register on `crud-form:business_rules.rule` (stacked above the fields, with CrudForm save events)
 * and `crud-form:business_rules.rule:header` (header actions, current form values as `data`).
 */
export const BUSINESS_RULE_FORM_SPOT_ID = 'crud-form:business_rules.rule'
