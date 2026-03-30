import { cf } from '@open-mercato/shared/modules/dsl'
import type { CustomFieldSet } from '@open-mercato/shared/modules/entities'
import { E as CoreEntities } from '#generated/entities.ids.generated'

export const CUSTOMER_PERSON_CUSTOM_FIELDS = [
  cf.select('buying_role', ['economic_buyer', 'champion', 'technical_evaluator', 'influencer'], {
    label: 'Buying role',
    description: 'Contact role within the buying committee.',
    filterable: true,
  }),
  cf.text('preferred_pronouns', {
    label: 'Preferred pronouns',
    description: 'How the contact prefers to be addressed.',
  }),
  cf.boolean('newsletter_opt_in', {
    label: 'Newsletter opt-in',
    description: 'Indicates whether marketing newsletters are permitted.',
    defaultValue: false,
  }),
]

export const CUSTOMER_COMPANY_CUSTOM_FIELDS = [
  cf.select('relationship_health', ['healthy', 'monitor', 'at_risk'], {
    label: 'Relationship health',
    description: 'Overall account health assessment.',
    filterable: true,
  }),
  cf.select('renewal_quarter', ['Q1', 'Q2', 'Q3', 'Q4'], {
    label: 'Renewal quarter',
    description: 'Expected renewal quarter for subscription accounts.',
    filterable: true,
  }),
  cf.multiline('executive_notes', {
    label: 'Executive notes',
    description: 'Context shared during executive reviews.',
    listVisible: false,
  }),
  cf.boolean('customer_marketing_case', {
    label: 'Marketing case study ready',
    description: 'The customer has approved participation in marketing collateral.',
    defaultValue: false,
  }),
]

export const CUSTOMER_DEAL_CUSTOM_FIELDS = [
  cf.select('competitive_risk', ['low', 'medium', 'high'], {
    label: 'Competitive risk',
    description: 'Perceived threat level from competitors.',
    filterable: true,
  }),
  cf.select('implementation_complexity', ['light', 'standard', 'complex'], {
    label: 'Implementation complexity',
    description: 'Expected level of effort for delivery.',
  }),
  cf.integer('estimated_seats', {
    label: 'Estimated seats/licenses',
    description: 'Projected seat count for the opportunity.',
    filterable: true,
  }),
  cf.boolean('requires_legal_review', {
    label: 'Requires legal review',
    description: 'Deal includes terms that need legal approval.',
    defaultValue: false,
  }),
]

export const CUSTOMER_ACTIVITY_CUSTOM_FIELDS = [
  cf.select('engagement_sentiment', ['positive', 'neutral', 'negative'], {
    label: 'Engagement sentiment',
    description: 'Tone of the interaction based on the latest touchpoint.',
    filterable: true,
  }),
  cf.boolean('shared_with_leadership', {
    label: 'Shared with leadership',
    description: 'Activity summary was shared with leadership or executives.',
    defaultValue: false,
  }),
  cf.text('follow_up_owner', {
    label: 'Follow-up owner',
    description: 'Team member responsible for the next follow-up.',
  }),
]

export const CUSTOMER_CUSTOM_FIELD_SETS: CustomFieldSet[] = [
  {
    entity: CoreEntities.customers.customer_person_profile,
    fields: CUSTOMER_PERSON_CUSTOM_FIELDS,
  },
  {
    entity: CoreEntities.customers.customer_company_profile,
    fields: CUSTOMER_COMPANY_CUSTOM_FIELDS,
  },
  {
    entity: CoreEntities.customers.customer_deal,
    fields: CUSTOMER_DEAL_CUSTOM_FIELDS,
  },
  {
    entity: CoreEntities.customers.customer_activity,
    fields: CUSTOMER_ACTIVITY_CUSTOM_FIELDS,
  },
  {
    entity: CoreEntities.customers.customer_interaction,
    fields: CUSTOMER_ACTIVITY_CUSTOM_FIELDS,
  },
]
