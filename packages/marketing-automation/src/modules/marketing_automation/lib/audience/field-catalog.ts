/**
 * What an audience may ask about, in a form a dropdown can render.
 *
 * Until this existed, authoring an audience meant typing a dot-path — `orders.daysSinceLast` — into a free
 * text box, and typing JSON into another one for anything list-shaped. That is a programmer's interface in
 * front of somebody whose job is marketing. Everything targetable is now enumerated here, with the value
 * control it needs and the operators that mean anything for it.
 *
 * **The stored expression does not change.** This describes the same `ConditionExpression` the platform's
 * own evaluator already reads, field for field and operator for operator; only the way it is authored is
 * different. A campaign written before this catalogue existed still evaluates identically, and one written
 * through the catalogue can still be read by the raw builder.
 *
 * The paths are the keys of `SubjectDocument`. A path that is not in that document matches nothing, so
 * every entry here is answerable by definition — and anything added to the document stays invisible to
 * authors until it is added here, which is the intended direction: a field becomes targetable when
 * somebody has decided what it is called and what it means.
 */

/** Operators as the platform's evaluator spells them. `NOT_CONTAINS`, not `NOT CONTAINS`. */
export type AudienceOperator =
  | '=' | '!=' | '>' | '>=' | '<' | '<='
  | 'CONTAINS' | 'NOT_CONTAINS'
  | 'IS_EMPTY' | 'IS_NOT_EMPTY'

/** What the value control has to be, which is the only thing the screen needs to decide. */
export type AudienceValueKind =
  /** A plain count. */
  | 'number'
  /** A count of days. Same control, different unit shown beside it. */
  | 'days'
  /** An amount. Same control; the shop's currency is not known per customer, so no symbol is claimed. */
  | 'money'
  /** Free text. */
  | 'text'
  /** One option from a list the tenant's own data supplies. */
  | 'choice'
  /** Membership of an array field: one option, compared with CONTAINS. */
  | 'inList'

/** Where a `choice` or `inList` field gets its options. Resolved per tenant, never hardcoded. */
export type AudienceOptionSource = 'segments' | 'tags' | 'categories' | 'channels' | 'tiers' | 'locales'

export type AudienceFieldGroup =
  | 'lists' | 'orders' | 'value' | 'loyalty' | 'engagement' | 'location' | 'survey' | 'customer'

export type AudienceField = {
  path: string
  group: AudienceFieldGroup
  labelKey: string
  kind: AudienceValueKind
  operators: AudienceOperator[]
  optionSource?: AudienceOptionSource
  /** A sentence under the row, for a field whose meaning is not obvious from its name. */
  hintKey?: string
  /** Bounds for a numeric control, where the field has natural ones. */
  min?: number
  max?: number
}

const COUNT: AudienceOperator[] = ['>=', '<=', '=']
const AMOUNT: AudienceOperator[] = ['>=', '<=']
const MEMBERSHIP: AudienceOperator[] = ['CONTAINS', 'NOT_CONTAINS']
const EXACT: AudienceOperator[] = ['=', '!=']

const key = (path: string) => `marketing_automation.audience.field.${path}`

/**
 * Ordered as somebody reasons about a customer, not as the document is laid out: who they are on a list
 * first, because that is what most campaigns target; the rarely-used identity fields last.
 */
export const AUDIENCE_FIELDS: AudienceField[] = [
  { path: 'segments', group: 'lists', labelKey: key('segments'), kind: 'inList', operators: MEMBERSHIP, optionSource: 'segments' },
  { path: 'tags', group: 'lists', labelKey: key('tags'), kind: 'inList', operators: MEMBERSHIP, optionSource: 'tags' },

  { path: 'orders.count', group: 'orders', labelKey: key('orders.count'), kind: 'number', operators: COUNT, min: 0 },
  { path: 'orders.totalGross', group: 'orders', labelKey: key('orders.totalGross'), kind: 'money', operators: AMOUNT, min: 0 },
  { path: 'orders.averageGross', group: 'orders', labelKey: key('orders.averageGross'), kind: 'money', operators: AMOUNT, min: 0 },
  {
    path: 'orders.daysSinceLast',
    group: 'orders',
    labelKey: key('orders.daysSinceLast'),
    kind: 'days',
    operators: AMOUNT,
    min: 0,
    // Worth saying on the screen: this is the one field where "no data" is not zero, and an author who
    // assumes otherwise writes a win-back campaign that targets people who have never bought anything.
    hintKey: `${key('orders.daysSinceLast')}.hint`,
  },
  { path: 'orders.categories', group: 'orders', labelKey: key('orders.categories'), kind: 'inList', operators: MEMBERSHIP, optionSource: 'categories' },
  /**
   * Typed rather than picked, unlike every other list field.
   *
   * A shop's categories and channels are a handful; its products are not, and a dropdown of ten thousand
   * SKUs is not a dropdown. Until there is a searching picker this stays a text box with a hint, which is
   * honest about what it wants — the code as it appears on the order.
   */
  {
    path: 'orders.skus',
    group: 'orders',
    labelKey: key('orders.skus'),
    kind: 'text',
    operators: MEMBERSHIP,
    hintKey: `${key('orders.skus')}.hint`,
  },
  { path: 'orders.channels', group: 'orders', labelKey: key('orders.channels'), kind: 'inList', operators: MEMBERSHIP, optionSource: 'channels' },

  {
    path: 'rfm.recency',
    group: 'value',
    labelKey: key('rfm.recency'),
    kind: 'number',
    operators: COUNT,
    min: 1,
    max: 5,
    hintKey: `${key('rfm')}.hint`,
  },
  { path: 'rfm.frequency', group: 'value', labelKey: key('rfm.frequency'), kind: 'number', operators: COUNT, min: 1, max: 5, hintKey: `${key('rfm')}.hint` },
  { path: 'rfm.monetary', group: 'value', labelKey: key('rfm.monetary'), kind: 'number', operators: COUNT, min: 1, max: 5, hintKey: `${key('rfm')}.hint` },
  { path: 'value.projectedAnnualGross', group: 'value', labelKey: key('value.projectedAnnualGross'), kind: 'money', operators: AMOUNT, min: 0 },
  { path: 'value.grossPercentile', group: 'value', labelKey: key('value.grossPercentile'), kind: 'number', operators: AMOUNT, min: 0, max: 100 },

  { path: 'score.points', group: 'loyalty', labelKey: key('score.points'), kind: 'number', operators: COUNT },
  { path: 'score.tier', group: 'loyalty', labelKey: key('score.tier'), kind: 'choice', operators: EXACT, optionSource: 'tiers' },
  {
    path: 'score.tierRank',
    group: 'loyalty',
    labelKey: key('score.tierRank'),
    kind: 'number',
    operators: AMOUNT,
    hintKey: `${key('score.tierRank')}.hint`,
  },

  { path: 'engagement.sent', group: 'engagement', labelKey: key('engagement.sent'), kind: 'number', operators: COUNT, min: 0 },
  { path: 'engagement.opened', group: 'engagement', labelKey: key('engagement.opened'), kind: 'number', operators: COUNT, min: 0 },
  { path: 'engagement.clicked', group: 'engagement', labelKey: key('engagement.clicked'), kind: 'number', operators: COUNT, min: 0 },
  {
    path: 'engagement.daysSinceEngaged',
    group: 'engagement',
    labelKey: key('engagement.daysSinceEngaged'),
    kind: 'days',
    operators: AMOUNT,
    min: 0,
    hintKey: `${key('engagement.daysSinceEngaged')}.hint`,
  },

  { path: 'address.country', group: 'location', labelKey: key('address.country'), kind: 'text', operators: EXACT },
  { path: 'address.city', group: 'location', labelKey: key('address.city'), kind: 'text', operators: EXACT },
  { path: 'address.postalCode', group: 'location', labelKey: key('address.postalCode'), kind: 'text', operators: EXACT },

  {
    path: 'survey.nps',
    group: 'survey',
    labelKey: key('survey.nps'),
    kind: 'number',
    operators: AMOUNT,
    min: 0,
    max: 10,
    hintKey: `${key('survey.nps')}.hint`,
  },

  { path: 'customer.locale', group: 'customer', labelKey: key('customer.locale'), kind: 'choice', operators: EXACT, optionSource: 'locales' },
  { path: 'customer.email', group: 'customer', labelKey: key('customer.email'), kind: 'text', operators: ['=', '!=', 'CONTAINS'] },
  { path: 'customer.displayName', group: 'customer', labelKey: key('customer.displayName'), kind: 'text', operators: ['=', '!=', 'CONTAINS'] },
]

export const AUDIENCE_FIELD_GROUPS: AudienceFieldGroup[] = [
  'lists', 'orders', 'value', 'loyalty', 'engagement', 'location', 'survey', 'customer',
]

export function findAudienceField(path: string): AudienceField | undefined {
  return AUDIENCE_FIELDS.find((field) => field.path === path)
}

/**
 * Whether a rule can be shown in the guided editor at all.
 *
 * A campaign authored through the raw builder may compare a path this catalogue does not describe, or use
 * an operator it does not offer for that path. Those rules are real and must keep working, so the screen
 * shows them read-only rather than rewriting them into something it can edit — silently changing somebody's
 * audience is worse than admitting one rule needs the advanced view.
 */
export function isEditableRule(path: string, operator: string): boolean {
  const field = findAudienceField(path)
  return !!field && field.operators.includes(operator as AudienceOperator)
}
