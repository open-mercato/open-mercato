import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer, type AppContainer } from '@open-mercato/shared/lib/di/container'
import { cf } from '@open-mercato/shared/modules/dsl'
import { randomUUID } from 'crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Dictionary, DictionaryEntry, type DictionaryManagerVisibility } from '@open-mercato/core/modules/dictionaries/data/entities'
import { installCustomEntitiesFromModules } from '@open-mercato/core/modules/entities/lib/install-from-ce'
import type { CacheStrategy } from '@open-mercato/cache/types'
import { ensureCustomFieldDefinitions } from '@open-mercato/core/modules/entities/lib/field-definitions'
import { DefaultDataEngine, type DataEngine } from '@open-mercato/shared/lib/data/engine'
import { E as CoreEntities } from '#generated/entities.ids.generated'
import { createProgressBar } from '@open-mercato/shared/lib/cli/progress'
import { buildIndexDocument, type IndexCustomFieldValue } from '@open-mercato/core/modules/query_index/lib/document'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import {
  CustomerEntity,
  CustomerCompanyProfile,
  CustomerPersonProfile,
  CustomerDeal,
  CustomerDealPersonLink,
  CustomerDealCompanyLink,
  CustomerActivity,
  CustomerAddress,
  CustomerComment,
  CustomerPipeline,
  CustomerPipelineStage,
} from './data/entities'
import { ensureDictionaryEntry } from './commands/shared'

type SeedArgs = {
  tenantId: string
  organizationId: string
}

type DictionaryDefault = {
  value: string
  label: string
  color?: string
  icon?: string
}

type CustomFieldValuesPayload = Parameters<DataEngine['setCustomFields']>[0]['values']
type ProgressBarHandle = ReturnType<typeof createProgressBar>

const DEAL_STATUS_DEFAULTS: DictionaryDefault[] = [
  { value: 'open', label: 'Open', color: '#2563eb', icon: 'lucide:circle' },
  { value: 'closed', label: 'Closed', color: '#6b7280', icon: 'lucide:check-circle' },
  { value: 'win', label: 'Win', color: '#22c55e', icon: 'lucide:trophy' },
  { value: 'loose', label: 'Loose', color: '#ef4444', icon: 'lucide:flag' },
  { value: 'in_progress', label: 'In progress', color: '#f59e0b', icon: 'lucide:activity' },
]

const PIPELINE_STAGE_DEFAULTS: DictionaryDefault[] = [
  { value: 'opportunity', label: 'Opportunity', color: '#38bdf8', icon: 'lucide:target' },
  { value: 'marketing_qualified_lead', label: 'Marketing Qualified Lead', color: '#a855f7', icon: 'lucide:sparkles' },
  { value: 'sales_qualified_lead', label: 'Sales Qualified Lead', color: '#f97316', icon: 'lucide:users' },
  { value: 'offering', label: 'Offering', color: '#22c55e', icon: 'lucide:package' },
  { value: 'negotiations', label: 'Negotiations', color: '#facc15', icon: 'lucide:handshake' },
  { value: 'win', label: 'Win', color: '#16a34a', icon: 'lucide:award' },
  { value: 'loose', label: 'Loose', color: '#ef4444', icon: 'lucide:flag' },
  { value: 'stalled', label: 'Stalled', color: '#6b7280', icon: 'lucide:alert-circle' },
]

const ENTITY_STATUS_DEFAULTS: DictionaryDefault[] = [
  { value: 'customer', label: 'Customer', color: '#16a34a', icon: 'lucide:handshake' },
  { value: 'active', label: 'Active', color: '#2563eb', icon: 'lucide:user-check' },
  { value: 'prospect', label: 'Prospect', color: '#f59e0b', icon: 'lucide:target' },
  { value: 'inactive', label: 'Inactive', color: '#6b7280', icon: 'lucide:archive' },
]

const ENTITY_LIFECYCLE_STAGE_DEFAULTS: DictionaryDefault[] = [
  { value: 'prospect', label: 'Prospect', color: '#f59e0b', icon: 'lucide:sparkles' },
  { value: 'evaluation', label: 'Evaluation', color: '#a855f7', icon: 'lucide:clipboard-list' },
  { value: 'customer', label: 'Customer', color: '#22c55e', icon: 'lucide:handshake' },
  { value: 'expansion', label: 'Expansion', color: '#0ea5e9', icon: 'lucide:trending-up' },
  { value: 'churned', label: 'Churned', color: '#ef4444', icon: 'lucide:alert-circle' },
]

const ENTITY_SOURCE_DEFAULTS: DictionaryDefault[] = [
  { value: 'partner_referral', label: 'Partner referral', color: '#6366f1', icon: 'lucide:handshake' },
  { value: 'customer_referral', label: 'Customer referral', color: '#22c55e', icon: 'lucide:thumbs-up' },
  { value: 'industry_event', label: 'Industry event', color: '#f97316', icon: 'lucide:calendar' },
  { value: 'inbound_web', label: 'Inbound web', color: '#0ea5e9', icon: 'lucide:globe' },
  { value: 'outbound_campaign', label: 'Outbound campaign', color: '#facc15', icon: 'lucide:megaphone' },
]

const ADDRESS_TYPE_DEFAULTS: DictionaryDefault[] = [
  { value: 'office', label: 'Office', color: '#3b82f6', icon: 'lucide:building' },
  { value: 'work', label: 'Work', color: '#6366f1', icon: 'lucide:briefcase' },
  { value: 'billing', label: 'Billing', color: '#f97316', icon: 'lucide:wallet' },
  { value: 'shipping', label: 'Shipping', color: '#22c55e', icon: 'lucide:truck' },
  { value: 'home', label: 'Home', color: '#10b981', icon: 'lucide:map-pin' },
]

const ACTIVITY_TYPE_DEFAULTS: DictionaryDefault[] = [
  { value: 'call', label: 'Call', color: '#2563eb', icon: 'lucide:phone-call' },
  { value: 'email', label: 'Email', color: '#16a34a', icon: 'lucide:mail' },
  { value: 'meeting', label: 'Meeting', color: '#f59e0b', icon: 'lucide:users' },
  { value: 'note', label: 'Note', color: '#a855f7', icon: 'lucide:notebook' },
  { value: 'task', label: 'Task', color: '#ef4444', icon: 'lucide:check-square' },
]

const JOB_TITLE_DEFAULTS: DictionaryDefault[] = [
  { value: 'Director of Operations', label: 'Director of Operations', color: '#f97316', icon: 'lucide:settings' },
  { value: 'VP of Partnerships', label: 'VP of Partnerships', color: '#6366f1', icon: 'lucide:users' },
  { value: 'Founder & Principal', label: 'Founder & Principal', color: '#ec4899', icon: 'lucide:star' },
  { value: 'Senior Project Manager', label: 'Senior Project Manager', color: '#0ea5e9', icon: 'lucide:clipboard-list' },
  { value: 'Chief Revenue Officer', label: 'Chief Revenue Officer', color: '#8b5cf6', icon: 'lucide:bar-chart-3' },
  { value: 'Director of Retail Partnerships', label: 'Director of Retail Partnerships', color: '#f59e0b', icon: 'lucide:shopping-bag' },
]

const INDUSTRY_DEFAULTS: DictionaryDefault[] = [
  { value: 'Renewable Energy', label: 'Renewable Energy' },
  { value: 'Software', label: 'Software' },
  { value: 'Interior Design', label: 'Interior Design' },
  { value: 'SaaS', label: 'SaaS' },
  { value: 'E-commerce', label: 'E-commerce' },
  { value: 'Healthcare', label: 'Healthcare' },
  { value: 'Manufacturing', label: 'Manufacturing' },
  { value: 'Logistics', label: 'Logistics' },
  { value: 'Financial Services', label: 'Financial Services' },
  { value: 'Retail', label: 'Retail' },
  { value: 'Hospitality', label: 'Hospitality' },
  { value: 'Energy', label: 'Energy' },
  { value: 'Media', label: 'Media' },
]

const PRIORITY_CURRENCIES = ['EUR', 'USD', 'GBP', 'PLN']

type ExampleAddress = {
  name?: string
  purpose?: string
  addressLine1: string
  addressLine2?: string
  city?: string
  region?: string
  postalCode?: string
  country?: string
  latitude?: number
  longitude?: number
  buildingNumber?: string
  flatNumber?: string
}

type ExamplePerson = {
  slug: string
  firstName: string
  lastName: string
  preferredName?: string
  jobTitle?: string
  department?: string
  seniority?: string
  email: string
  phone?: string
  timezone?: string
  linkedInUrl?: string
  twitterUrl?: string
  address?: ExampleAddress
  description?: string
  source?: string
  custom?: Record<string, unknown>
}

type ExampleDealParticipant = {
  slug: string
  participantRole?: string
}

type ExampleActivity = {
  slug: string
  entity: 'company' | 'person'
  personSlug?: string
  type: string
  subject?: string
  body?: string
  occurredAt: string
  icon?: string
  color?: string
  custom?: Record<string, unknown>
}

type ExampleNote = {
  entity: 'company' | 'person'
  personSlug?: string
  body: string
  occurredAt?: string
  icon?: string
  color?: string
}

type ExampleDeal = {
  slug: string
  title: string
  description?: string
  status: string
  pipelineStage?: string
  valueAmount?: number
  valueCurrency?: string
  probability?: number
  expectedCloseAt?: string
  people: ExampleDealParticipant[]
  activities?: ExampleActivity[]
  source?: string
  custom?: Record<string, unknown>
}

type ExampleCompany = {
  slug: string
  displayName: string
  legalName?: string
  brandName?: string
  industry?: string
  sizeBucket?: string
  domain?: string
  websiteUrl?: string
  description?: string
  primaryEmail?: string
  primaryPhone?: string
  source?: string
  lifecycleStage?: string
  status?: string
  annualRevenue?: number
  address?: ExampleAddress
  people?: ExamplePerson[]
  deals?: ExampleDeal[]
  interactions?: ExampleActivity[]
  notes?: ExampleNote[]
  custom?: Record<string, unknown>
}

const NOW = new Date()

function isoDaysFromNow(days: number, options?: { hour?: number; minute?: number }): string {
  const base = new Date(NOW)
  const hour = options?.hour ?? 12
  const minute = options?.minute ?? 0
  base.setUTCHours(hour, minute, 0, 0)
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString()
}

const CUSTOMER_EXAMPLES: ExampleCompany[] = [
  {
    slug: 'brightside-solar',
    displayName: 'Brightside Solar',
    legalName: 'Brightside Solar LLC',
    brandName: 'Brightside Solar',
    industry: 'Renewable Energy',
    sizeBucket: '51-200',
    domain: 'brightsidesolar.com',
    websiteUrl: 'https://brightsidesolar.com',
    description:
      'Community solar developer helping multifamily buildings reduce energy costs across California.',
    primaryEmail: 'hello@brightsidesolar.com',
    primaryPhone: '+1 415-555-0148',
    source: 'partner_referral',
    lifecycleStage: 'customer',
    status: 'customer',
    custom: {
      relationship_health: 'healthy',
      renewal_quarter: 'Q3',
      executive_notes: 'High NPS across HOA portfolio; exploring bundled battery upsell for 2025 budgets.',
      customer_marketing_case: true,
    },
    address: {
      name: 'Headquarters',
      purpose: 'office',
      addressLine1: '245 Market St Suite 400',
      city: 'San Francisco',
      region: 'CA',
      postalCode: '94105',
      country: 'US',
      latitude: 37.7936,
      longitude: -122.3965,
    },
    people: [
      {
        slug: 'mia-johnson',
        firstName: 'Mia',
        lastName: 'Johnson',
        preferredName: 'Mia',
        jobTitle: 'Director of Operations',
        department: 'Operations',
        seniority: 'director',
        email: 'mia.johnson@brightsidesolar.com',
        phone: '+1 415-555-0162',
        timezone: 'America/Los_Angeles',
        linkedInUrl: 'https://www.linkedin.com/in/miajohnson-operations/',
        source: 'partner_referral',
        custom: {
          buying_role: 'champion',
          preferred_pronouns: 'she/her',
          newsletter_opt_in: true,
        },
        address: {
          purpose: 'work',
          addressLine1: '245 Market St Suite 410',
          city: 'San Francisco',
          region: 'CA',
          postalCode: '94105',
          country: 'US',
        },
      },
      {
        slug: 'daniel-cho',
        firstName: 'Daniel',
        lastName: 'Cho',
        jobTitle: 'VP of Partnerships',
        department: 'Business Development',
        seniority: 'vp',
        email: 'daniel.cho@brightsidesolar.com',
        phone: '+1 628-555-0199',
        timezone: 'America/Los_Angeles',
        linkedInUrl: 'https://www.linkedin.com/in/danielcho-energy/',
        source: 'outbound_campaign',
        custom: {
          buying_role: 'economic_buyer',
          preferred_pronouns: 'he/him',
          newsletter_opt_in: false,
        },
      },
    ],
    deals: [
      {
        slug: 'redwood-residences',
        title: 'Redwood Residences Solar Rollout',
        description: '40-home solar installation with ongoing maintenance plan.',
        status: 'in_progress',
        pipelineStage: 'negotiations',
        valueAmount: 185000,
        valueCurrency: 'USD',
        expectedCloseAt: isoDaysFromNow(45),
        probability: 55,
        source: 'partner_referral',
        custom: {
          competitive_risk: 'medium',
          implementation_complexity: 'standard',
          estimated_seats: 40,
          requires_legal_review: true,
        },
        people: [
          { slug: 'mia-johnson', participantRole: 'Project Sponsor' },
          { slug: 'daniel-cho', participantRole: 'Executive Sponsor' },
        ],
        activities: [
          {
            slug: 'redwood-hoa-follow-up',
            entity: 'company',
            type: 'call',
            subject: 'Follow-up with HOA board',
            body: 'Reviewed financing options and clarified maintenance service tiers for the board.',
            occurredAt: isoDaysFromNow(-9, { hour: 17, minute: 30 }),
            icon: 'lucide:phone-call',
            color: '#2563eb',
            custom: {
              engagement_sentiment: 'positive',
              shared_with_leadership: true,
              follow_up_owner: 'Sofia Nguyen',
            },
          },
          {
            slug: 'redwood-case-studies',
            entity: 'person',
            personSlug: 'mia-johnson',
            type: 'note',
            subject: 'Shared case studies',
            body: 'Sent two case studies highlighting 18% average utility bill savings for similar complexes.',
            occurredAt: isoDaysFromNow(-7, { hour: 19, minute: 15 }),
            icon: 'lucide:notebook',
            color: '#a855f7',
            custom: {
              engagement_sentiment: 'positive',
              shared_with_leadership: false,
              follow_up_owner: 'Daniel Cho',
            },
          },
        ],
      },
      {
        slug: 'sunset-lofts-battery',
        title: 'Sunset Lofts Battery Upgrade',
        description: 'Battery upgrade for existing solar customers to extend overnight coverage.',
        status: 'open',
        pipelineStage: 'offering',
        valueAmount: 82000,
        valueCurrency: 'USD',
        expectedCloseAt: isoDaysFromNow(65),
        probability: 40,
        source: 'inbound_web',
        custom: {
          competitive_risk: 'high',
          implementation_complexity: 'complex',
          estimated_seats: 28,
          requires_legal_review: false,
        },
        people: [{ slug: 'mia-johnson', participantRole: 'Point of Contact' }],
        activities: [
          {
            slug: 'sunset-energy-audit',
            entity: 'company',
            type: 'meeting',
            subject: 'On-site energy audit completed',
            body: 'Audit identified 28 units that need inverter firmware updates before batteries ship.',
            occurredAt: isoDaysFromNow(-17, { hour: 21 }),
            icon: 'lucide:users',
            color: '#f59e0b',
            custom: {
              engagement_sentiment: 'neutral',
              shared_with_leadership: false,
              follow_up_owner: 'Mia Johnson',
            },
          },
        ],
      },
    ],
    interactions: [
      {
        slug: 'brightside-nps-email',
        entity: 'company',
        type: 'email',
        subject: 'Quarterly NPS survey sent',
        body: 'Shared Q2 satisfaction survey with portfolio property managers.',
        occurredAt: isoDaysFromNow(-20, { hour: 16 }),
        icon: 'lucide:mail',
        color: '#16a34a',
        custom: {
          engagement_sentiment: 'positive',
          shared_with_leadership: false,
          follow_up_owner: 'Customer Success Team',
        },
      },
    ],
    notes: [
      {
        entity: 'company',
        body: 'Completed energy audit across 12 HOA buildings; evaluating maintenance bundle add-on.',
        occurredAt: isoDaysFromNow(-11, { hour: 18 }),
        icon: 'lucide:lightbulb',
        color: '#facc15',
      },
      {
        entity: 'person',
        personSlug: 'mia-johnson',
        body: 'Mia requested financing comparison deck before the board vote.',
        occurredAt: isoDaysFromNow(-9, { hour: 15, minute: 30 }),
        icon: 'lucide:bookmark',
        color: '#a855f7',
      },
    ],
  },
  {
    slug: 'harborview-analytics',
    displayName: 'Harborview Analytics',
    legalName: 'Harborview Analytics Inc.',
    brandName: 'Harborview Analytics',
    industry: 'Software',
    sizeBucket: '201-500',
    domain: 'harborviewanalytics.com',
    websiteUrl: 'https://harborviewanalytics.com',
    description:
      'Boston-based analytics platform helping consumer brands optimize merchandising decisions.',
    primaryEmail: 'info@harborviewanalytics.com',
    primaryPhone: '+1 617-555-0024',
    source: 'industry_event',
    lifecycleStage: 'prospect',
    status: 'active',
    custom: {
      relationship_health: 'monitor',
      renewal_quarter: 'Q4',
      executive_notes: 'Pilot success metrics trending positive; CFO wants ROI modeling before expansion.',
      customer_marketing_case: false,
    },
    address: {
      name: 'Boston HQ',
      purpose: 'office',
      addressLine1: '355 Atlantic Ave Floor 6',
      city: 'Boston',
      region: 'MA',
      postalCode: '02210',
      country: 'US',
      latitude: 42.3522,
      longitude: -71.0507,
    },
    people: [
      {
        slug: 'arjun-patel',
        firstName: 'Arjun',
        lastName: 'Patel',
        jobTitle: 'Chief Revenue Officer',
        department: 'Revenue',
        seniority: 'c-level',
        email: 'arjun.patel@harborviewanalytics.com',
        phone: '+1 617-555-0168',
        timezone: 'America/New_York',
        linkedInUrl: 'https://www.linkedin.com/in/arjunpatel-sales/',
        source: 'industry_event',
        custom: {
          buying_role: 'economic_buyer',
          preferred_pronouns: 'he/him',
          newsletter_opt_in: true,
        },
      },
      {
        slug: 'lena-ortiz',
        firstName: 'Lena',
        lastName: 'Ortiz',
        jobTitle: 'Director of Retail Partnerships',
        department: 'Partnerships',
        seniority: 'director',
        email: 'lena.ortiz@harborviewanalytics.com',
        phone: '+1 617-555-0179',
        timezone: 'America/New_York',
        linkedInUrl: 'https://www.linkedin.com/in/lenaortiz-retail/',
        source: 'industry_event',
        custom: {
          buying_role: 'champion',
          preferred_pronouns: 'she/her',
          newsletter_opt_in: true,
        },
      },
    ],
    deals: [
      {
        slug: 'blue-harbor-pilot',
        title: 'Blue Harbor Grocers Pilot Program',
        description: 'Six-month pilot of merchandising analytics across 28 locations.',
        status: 'win',
        pipelineStage: 'win',
        valueAmount: 96000,
        valueCurrency: 'USD',
        expectedCloseAt: isoDaysFromNow(-25),
        probability: 100,
        source: 'industry_event',
        custom: {
          competitive_risk: 'low',
          implementation_complexity: 'standard',
          estimated_seats: 28,
          requires_legal_review: false,
        },
        people: [
          { slug: 'arjun-patel', participantRole: 'Executive Sponsor' },
          { slug: 'lena-ortiz', participantRole: 'Account Lead' },
        ],
        activities: [
          {
            slug: 'blue-harbor-contract',
            entity: 'company',
            type: 'meeting',
            subject: 'Contract signed with procurement',
            body: 'Procurement signed SOW; onboarding kickoff scheduled for next Tuesday.',
            occurredAt: isoDaysFromNow(-28, { hour: 14, minute: 30 }),
            icon: 'lucide:handshake',
            color: '#22c55e',
            custom: {
              engagement_sentiment: 'positive',
              shared_with_leadership: true,
              follow_up_owner: 'Lena Ortiz',
            },
          },
          {
            slug: 'blue-harbor-onboarding-email',
            entity: 'person',
            personSlug: 'lena-ortiz',
            type: 'email',
            subject: 'Shared onboarding checklist',
            body: 'Sent checklist covering data exports and point-of-sale integrations required for go-live.',
            occurredAt: isoDaysFromNow(-27, { hour: 13, minute: 5 }),
            icon: 'lucide:mail',
            color: '#16a34a',
            custom: {
              engagement_sentiment: 'positive',
              shared_with_leadership: false,
              follow_up_owner: 'Implementation Team',
            },
          },
        ],
      },
      {
        slug: 'midwest-outfitters',
        title: 'Midwest Outfitters Expansion',
        description: 'Expansion opportunity covering 120 stores in the Midwest region.',
        status: 'open',
        pipelineStage: 'opportunity',
        valueAmount: 210000,
        valueCurrency: 'USD',
        expectedCloseAt: isoDaysFromNow(120),
        probability: 35,
        source: 'outbound_campaign',
        custom: {
          competitive_risk: 'medium',
          implementation_complexity: 'complex',
          estimated_seats: 120,
          requires_legal_review: true,
        },
        people: [{ slug: 'lena-ortiz', participantRole: 'Account Lead' }],
        activities: [
          {
            slug: 'midwest-forecasting-call',
            entity: 'company',
            type: 'call',
            subject: 'Introduced predictive forecasting module',
            body: 'Walkthrough of demand forecasting module with COO and finance controller.',
            occurredAt: isoDaysFromNow(-14, { hour: 15, minute: 45 }),
            icon: 'lucide:phone-call',
            color: '#2563eb',
            custom: {
              engagement_sentiment: 'positive',
              shared_with_leadership: true,
              follow_up_owner: 'Arjun Patel',
            },
          },
        ],
      },
    ],
    interactions: [
      {
        slug: 'harborview-pricing-note',
        entity: 'person',
        personSlug: 'arjun-patel',
        type: 'note',
        subject: 'Requested pricing comparison',
        body: 'Arjun asked for pricing comparison versus Qlik ahead of board review.',
        occurredAt: isoDaysFromNow(-18, { hour: 12, minute: 10 }),
        icon: 'lucide:notebook',
        color: '#a855f7',
        custom: {
          engagement_sentiment: 'neutral',
          shared_with_leadership: true,
          follow_up_owner: 'Finance Team',
        },
      },
    ],
    notes: [
      {
        entity: 'company',
        body: 'Pilot success metrics shared with board; expansion depends on Q4 budget review.',
        occurredAt: isoDaysFromNow(-16, { hour: 17, minute: 45 }),
        icon: 'lucide:bar-chart-3',
        color: '#38bdf8',
      },
      {
        entity: 'person',
        personSlug: 'lena-ortiz',
        body: 'Lena confirmed data team can supply POS exports within two weeks.',
        occurredAt: isoDaysFromNow(-13, { hour: 11, minute: 20 }),
        icon: 'lucide:clipboard-list',
        color: '#0ea5e9',
      },
    ],
  },
  {
    slug: 'copperleaf-design',
    displayName: 'Copperleaf Design Co.',
    legalName: 'Copperleaf Design Company',
    brandName: 'Copperleaf Design',
    industry: 'Interior Design',
    sizeBucket: '11-50',
    domain: 'copperleaf.design',
    websiteUrl: 'https://copperleaf.design',
    description:
      'Boutique interior design studio specializing in hospitality and boutique retail projects across Texas.',
    primaryEmail: 'studio@copperleaf.design',
    primaryPhone: '+1 512-555-0456',
    source: 'customer_referral',
    lifecycleStage: 'customer',
    status: 'customer',
    custom: {
      relationship_health: 'healthy',
      renewal_quarter: 'Q1',
      executive_notes: 'Boutique studio with strong referrals; share sustainability case studies with ownership group.',
      customer_marketing_case: true,
    },
    address: {
      name: 'Austin Studio',
      purpose: 'office',
      addressLine1: '1101 E 6th St Suite 220',
      city: 'Austin',
      region: 'TX',
      postalCode: '78702',
      country: 'US',
      latitude: 30.2642,
      longitude: -97.7275,
    },
    people: [
      {
        slug: 'taylor-brooks',
        firstName: 'Taylor',
        lastName: 'Brooks',
        jobTitle: 'Founder & Principal',
        department: 'Leadership',
        seniority: 'c-level',
        email: 'taylor.brooks@copperleaf.design',
        phone: '+1 512-555-0489',
        timezone: 'America/Chicago',
        linkedInUrl: 'https://www.linkedin.com/in/taylorbrooks-design/',
        source: 'customer_referral',
        custom: {
          buying_role: 'economic_buyer',
          preferred_pronouns: 'they/them',
          newsletter_opt_in: false,
        },
      },
      {
        slug: 'naomi-harris',
        firstName: 'Naomi',
        lastName: 'Harris',
        jobTitle: 'Senior Project Manager',
        department: 'Projects',
        seniority: 'manager',
        email: 'naomi.harris@copperleaf.design',
        phone: '+1 512-555-0521',
        timezone: 'America/Chicago',
        linkedInUrl: 'https://www.linkedin.com/in/naomiharris-pm/',
        source: 'customer_referral',
        custom: {
          buying_role: 'influencer',
          preferred_pronouns: 'she/her',
          newsletter_opt_in: true,
        },
      },
    ],
    deals: [
      {
        slug: 'wanderstay-renovation',
        title: 'Wanderstay Boutique Renovation',
        description: 'Full lobby and guest suite redesign for the Wanderstay hospitality group.',
        status: 'in_progress',
        pipelineStage: 'sales_qualified_lead',
        valueAmount: 145000,
        valueCurrency: 'USD',
        expectedCloseAt: isoDaysFromNow(35),
        probability: 65,
        source: 'customer_referral',
        custom: {
          competitive_risk: 'medium',
          implementation_complexity: 'complex',
          estimated_seats: 12,
          requires_legal_review: true,
        },
        people: [
          { slug: 'taylor-brooks', participantRole: 'Principal Designer' },
          { slug: 'naomi-harris', participantRole: 'Project Lead' },
        ],
        activities: [
          {
            slug: 'wanderstay-workshop-recap',
            entity: 'person',
            personSlug: 'naomi-harris',
            type: 'meeting',
            subject: 'Design workshop recap',
            body: 'Captured lighting and materials feedback from onsite workshop with hospitality team.',
            occurredAt: isoDaysFromNow(-6, { hour: 20 }),
            icon: 'lucide:users',
            color: '#f59e0b',
            custom: {
              engagement_sentiment: 'positive',
              shared_with_leadership: false,
              follow_up_owner: 'Naomi Harris',
            },
          },
        ],
      },
      {
        slug: 'cedar-creek-retreat',
        title: 'Cedar Creek Retreat Expansion',
        description: 'New wellness center build-out including retail area and treatment rooms.',
        status: 'loose',
        pipelineStage: 'loose',
        valueAmount: 98000,
        valueCurrency: 'USD',
        expectedCloseAt: isoDaysFromNow(-70),
        probability: 0,
        source: 'customer_referral',
        custom: {
          competitive_risk: 'high',
          implementation_complexity: 'standard',
          estimated_seats: 8,
          requires_legal_review: false,
        },
        people: [{ slug: 'taylor-brooks', participantRole: 'Principal Designer' }],
        activities: [
          {
            slug: 'cedar-creek-loss-note',
            entity: 'company',
            type: 'note',
            subject: 'Lost due to budget constraints',
            body: 'Retreat selected lower-cost vendor focused on prefabricated interiors.',
            occurredAt: isoDaysFromNow(-68, { hour: 18, minute: 45 }),
            icon: 'lucide:alert-circle',
            color: '#ef4444',
            custom: {
              engagement_sentiment: 'negative',
              shared_with_leadership: true,
              follow_up_owner: 'Taylor Brooks',
            },
          },
        ],
      },
    ],
    interactions: [
      {
        slug: 'copperleaf-referral-call',
        entity: 'company',
        type: 'call',
        subject: 'Referred by Venture Hospitality',
        body: 'Received referral from Venture Hospitality after successful Austin project.',
        occurredAt: isoDaysFromNow(-25, { hour: 16, minute: 45 }),
        icon: 'lucide:phone',
        color: '#2563eb',
        custom: {
          engagement_sentiment: 'positive',
          shared_with_leadership: true,
          follow_up_owner: 'Taylor Brooks',
        },
      },
    ],
    notes: [
      {
        entity: 'company',
        body: 'Client interested in sustainable materials library review during next site visit.',
        occurredAt: isoDaysFromNow(-22, { hour: 19, minute: 10 }),
        icon: 'lucide:lightbulb',
        color: '#22c55e',
      },
      {
        entity: 'person',
        personSlug: 'naomi-harris',
        body: 'Naomi requested updated FF&E budget before presenting to ownership group.',
        occurredAt: isoDaysFromNow(-6, { hour: 21, minute: 5 }),
        icon: 'lucide:clipboard-list',
        color: '#0ea5e9',
      },
    ],
  },
]

const STRESS_TEST_SOURCE = 'stress_test'
const STRESS_TEST_FIRST_NAMES = [
  'Alex',
  'Jordan',
  'Taylor',
  'Morgan',
  'Casey',
  'Riley',
  'Hayden',
  'Skyler',
  'Quinn',
  'Peyton',
  'Harper',
  'Rowan',
  'Sawyer',
  'Avery',
  'Reese',
]
const STRESS_TEST_LAST_NAMES = [
  'Rivera',
  'Chen',
  'Nguyen',
  'Harper',
  'Ellis',
  'Patel',
  'Khan',
  'Silva',
  'Lopez',
  'Murphy',
  'Baker',
  'Diaz',
  'Foster',
  'Gonzalez',
  'Kim',
]
const STRESS_TEST_JOB_TITLES = [
  'Account Executive',
  'Growth Manager',
  'Customer Success Lead',
  'Operations Specialist',
  'Procurement Analyst',
  'Demand Generation Manager',
  'Solutions Consultant',
  'Revenue Operations Partner',
  'Implementation Manager',
  'Sales Engineer',
]
const STRESS_TEST_DEPARTMENTS = [
  'Revenue',
  'Operations',
  'Customer Experience',
  'Procurement',
  'Strategy',
  'Marketing',
  'Sales',
]
const STRESS_TEST_SENIORITY = ['junior', 'mid', 'senior', 'lead', 'director']
const STRESS_TEST_TIMEZONES = [
  'America/New_York',
  'America/Los_Angeles',
  'America/Chicago',
  'Europe/Berlin',
  'Europe/Warsaw',
  'Europe/London',
  'Asia/Singapore',
]
const STRESS_TEST_COMPANY_PREFIX = [
  'Atlas',
  'Northwind',
  'Summit',
  'Vertex',
  'Harbor',
  'Cobalt',
  'Juniper',
  'Orion',
  'Beacon',
  'Silverline',
  'Brightside',
  'Evergreen',
  'Lakeshore',
  'Bluefield',
  'Aurora',
]
const STRESS_TEST_COMPANY_SUFFIX = ['Industries', 'Partners', 'Holdings', 'Collective', 'Group', 'Ventures']
const STRESS_TEST_INDUSTRIES = [
  'SaaS',
  'E-commerce',
  'Healthcare',
  'Manufacturing',
  'Logistics',
  'Financial Services',
  'Retail',
  'Hospitality',
  'Energy',
  'Media',
]
const STRESS_TEST_SIZE_BUCKETS = ['1-10', '11-50', '51-200', '201-500', '500+']
const STRESS_TEST_EMAIL_DOMAIN = 'stress.test'
const STRESS_TEST_BUYING_ROLES = ['economic_buyer', 'champion', 'technical_evaluator', 'influencer']
const STRESS_TEST_PRONOUNS = ['they/them', 'she/her', 'he/him']
const STRESS_TEST_RELATIONSHIP_HEALTH = ['healthy', 'monitor', 'at_risk']
const STRESS_TEST_RENEWAL_QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4']
const STRESS_TEST_ACTIVITY_SENTIMENT = ['positive', 'neutral', 'negative']
const STRESS_TEST_ACTIVITY_OWNERS = [
  'Jordan Lane',
  'Alex Rivers',
  'Morgan Ellis',
  'Taylor Chen',
  'Casey Ortega',
  'Riley Summers',
]
const STRESS_TEST_DEAL_ACTIVITY_TYPES = ACTIVITY_TYPE_DEFAULTS.map((entry) => entry.value)
const STRESS_TEST_DEAL_STATUSES = DEAL_STATUS_DEFAULTS.map((entry) => entry.value)
const STRESS_TEST_DEAL_PIPELINE = PIPELINE_STAGE_DEFAULTS.map((entry) => entry.value)
const STRESS_TEST_DEAL_CUSTOMER_ROLES = ['evaluation lead', 'decision maker', 'influencer', 'sponsor']
const STRESS_TEST_DEAL_RISK = ['low', 'medium', 'high']
const STRESS_TEST_IMPLEMENTATION = ['light', 'standard', 'complex']
const STRESS_TEST_ACTIVITY_ICONS = ['lucide:phone-call', 'lucide:mail', 'lucide:calendar', 'lucide:users']
const STRESS_TEST_ACTIVITY_SUBJECTS = [
  'Discovery call',
  'Quarterly business review',
  'Implementation planning',
  'Renewal alignment',
  'Expansion pitch',
  'Stakeholder sync',
  'Onboarding follow-up',
]
const STRESS_TEST_ACTIVITY_BODIES = [
  'Reviewed account metrics and confirmed action plan for next quarter.',
  'Aligned on implementation milestones and risk mitigation.',
  'Shared updated proposal and captured feedback from stakeholders.',
  'Clarified contract terms and renewal incentives.',
  'Coordinated pilot scope with the core project team.',
  'Captured next steps for executive briefing.',
]
const STRESS_TEST_NOTE_SNIPPETS = [
  'Customer excited about roadmap items for Q3.',
  'Need to loop in billing once pricing draft is approved.',
  'Leadership wants a success story before expansion.',
  'Security questionnaire still pending from customer.',
  'Plan to introduce CS lead during next onsite visit.',
  'Team asked for sandbox access for analytics squad.',
]

function toAmount(value?: number): string | null {
  if (typeof value !== 'number') return null
  return value.toFixed(2)
}

function randomChoice<T>(values: readonly T[]): T {
  return values[Math.floor(Math.random() * values.length)]
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function slugifyValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function buildPhone(index: number): string {
  const block = String(400 + (index % 500)).padStart(3, '0')
  const last = String(1000 + (index % 9000)).slice(0, 4)
  return `+1-555-${block}-${last}`
}

function randomPastDate(maxDaysOffset: number): Date {
  const now = Date.now()
  const days = Math.random() * Math.max(1, maxDaysOffset)
  const ms = days * 24 * 60 * 60 * 1000
  return new Date(now - ms)
}

function randomFutureDate(maxDaysOffset: number): Date {
  const now = Date.now()
  const days = Math.random() * Math.max(1, maxDaysOffset)
  const ms = days * 24 * 60 * 60 * 1000
  return new Date(now + ms)
}

type ProgressInfo = {
  completed: number
  total: number
}

type ProgressCallback = (info: ProgressInfo) => void

type StressTestOptions = {
  count: number
  onProgress?: ProgressCallback
  includeExtras?: boolean
}

function parseArgs(rest: string[]): Record<string, string> {
  const args: Record<string, string> = {}
  for (let i = 0; i < rest.length; i += 1) {
    const part = rest[i]
    if (!part?.startsWith('--')) continue
    const [keyRaw, valueRaw] = part.slice(2).split('=')
    if (keyRaw) {
      if (valueRaw !== undefined) args[keyRaw] = valueRaw
      else if (i + 1 < rest.length && !rest[i + 1].startsWith('--')) args[keyRaw] = rest[i + 1]
      else args[keyRaw] = 'true'
    }
  }
  return args
}

async function seedCustomerDictionaries(em: EntityManager, { tenantId, organizationId }: SeedArgs) {
  for (const entry of ENTITY_STATUS_DEFAULTS) {
    await ensureDictionaryEntry(em, {
      tenantId,
      organizationId,
      kind: 'status',
      value: entry.value,
      label: entry.label,
      color: entry.color,
      icon: entry.icon,
    })
  }
  for (const entry of ENTITY_LIFECYCLE_STAGE_DEFAULTS) {
    await ensureDictionaryEntry(em, {
      tenantId,
      organizationId,
      kind: 'lifecycle_stage',
      value: entry.value,
      label: entry.label,
      color: entry.color,
      icon: entry.icon,
    })
  }
  for (const entry of ENTITY_SOURCE_DEFAULTS) {
    await ensureDictionaryEntry(em, {
      tenantId,
      organizationId,
      kind: 'source',
      value: entry.value,
      label: entry.label,
      color: entry.color,
      icon: entry.icon,
    })
  }
  for (const entry of ADDRESS_TYPE_DEFAULTS) {
    await ensureDictionaryEntry(em, {
      tenantId,
      organizationId,
      kind: 'address_type',
      value: entry.value,
      label: entry.label,
      color: entry.color,
      icon: entry.icon,
    })
  }
  for (const entry of ACTIVITY_TYPE_DEFAULTS) {
    await ensureDictionaryEntry(em, {
      tenantId,
      organizationId,
      kind: 'activity_type',
      value: entry.value,
      label: entry.label,
      color: entry.color,
      icon: entry.icon,
    })
  }
  for (const entry of JOB_TITLE_DEFAULTS) {
    await ensureDictionaryEntry(em, {
      tenantId,
      organizationId,
      kind: 'job_title',
      value: entry.value,
      label: entry.label,
      color: entry.color,
      icon: entry.icon,
    })
  }
  for (const entry of DEAL_STATUS_DEFAULTS) {
    await ensureDictionaryEntry(em, {
      tenantId,
      organizationId,
      kind: 'deal_status',
      value: entry.value,
      label: entry.label,
      color: entry.color,
      icon: entry.icon,
    })
  }
  for (const entry of PIPELINE_STAGE_DEFAULTS) {
    await ensureDictionaryEntry(em, {
      tenantId,
      organizationId,
      kind: 'pipeline_stage',
      value: entry.value,
      label: entry.label,
      color: entry.color,
      icon: entry.icon,
    })
  }
  for (const entry of INDUSTRY_DEFAULTS) {
    await ensureDictionaryEntry(em, {
      tenantId,
      organizationId,
      kind: 'industry',
      value: entry.value,
      label: entry.label,
      color: entry.color,
      icon: entry.icon,
    })
  }
}

function resolveCurrencyCodes(): string[] {
  const normalizedPriority = PRIORITY_CURRENCIES.map((code) => code.toUpperCase())
  const intlWithSupportedValues = Intl as typeof Intl & {
    supportedValuesOf?: (input: 'currency') => string[]
  }
  const supported: string[] =
    typeof intlWithSupportedValues.supportedValuesOf === 'function'
      ? intlWithSupportedValues.supportedValuesOf('currency')
      : []
  const normalizedSupported = supported
    .map((code) => code.toUpperCase())
    .filter((code) => /^[A-Z]{3}$/.test(code))
  const uniqueSupported: string[] = []
  const seen = new Set<string>(normalizedPriority)
  for (const code of normalizedSupported) {
    if (seen.has(code)) continue
    seen.add(code)
    uniqueSupported.push(code)
  }
  if (!uniqueSupported.length) {
    console.warn('[customers.cli] Intl.supportedValuesOf("currency") unavailable; seeding minimal currency list.')
    return normalizedPriority
  }
  uniqueSupported.sort()
  return [...normalizedPriority, ...uniqueSupported]
}

function resolveCurrencyLabel(code: string): string {
  try {
    const intlWithDisplayNames = Intl as typeof Intl & {
      DisplayNames?: new (locales: string[], options: { type: 'currency' }) => {
        of(value: string): string | undefined
      }
    }
    if (typeof intlWithDisplayNames.DisplayNames === 'function') {
      const displayNames = new intlWithDisplayNames.DisplayNames(['en'], { type: 'currency' })
      const label = displayNames.of(code)
      if (typeof label === 'string' && label.trim().length) {
        return `${code} – ${label}`
      }
    }
  } catch (err) {
    console.warn('[customers.cli] Unable to resolve currency label for', code, err)
  }
  return code
}

async function seedCurrencyDictionary(em: EntityManager, { tenantId, organizationId }: SeedArgs) {
  let dictionary = await em.findOne(Dictionary, {
    tenantId,
    organizationId,
    key: 'currency',
    deletedAt: null,
  })
  if (!dictionary) {
    dictionary = em.create(Dictionary, {
      key: 'currency',
      name: 'Currencies',
      description: 'ISO 4217 currencies',
      tenantId,
      organizationId,
      isSystem: true,
      isActive: true,
      managerVisibility: 'default' satisfies DictionaryManagerVisibility,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(dictionary)
    await em.flush()
  }

  const existingEntries = await em.find(DictionaryEntry, {
    dictionary,
    tenantId,
    organizationId,
  })
  const existingMap = new Map<string, DictionaryEntry>()
  existingEntries.forEach((entry) => existingMap.set(entry.value.toUpperCase(), entry))

  const currencyCodes = resolveCurrencyCodes()
  for (const code of currencyCodes) {
    const upper = code.toUpperCase()
    const normalizedValue = upper.toLowerCase()
    const label = resolveCurrencyLabel(upper)
    const current = existingMap.get(upper)
    if (current) {
      if (current.label !== label) {
        current.label = label
        current.updatedAt = new Date()
        em.persist(current)
      }
      continue
    }
    const entry = em.create(DictionaryEntry, {
      dictionary,
      tenantId,
      organizationId,
      value: upper,
      normalizedValue,
      label,
      color: null,
      icon: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(entry)
  }
}

async function seedCustomerExamples(
  em: EntityManager,
  container: AppContainer,
  { tenantId, organizationId }: SeedArgs
): Promise<boolean> {
  const exampleDealTitles = Array.from(
    new Set(
      CUSTOMER_EXAMPLES.flatMap((company) =>
        (company.deals ?? []).map((deal) => deal.title).filter((title): title is string => typeof title === 'string')
      )
    )
  )
  if (exampleDealTitles.length > 0) {
    const already = await em.count(CustomerDeal, {
      tenantId,
      organizationId,
      title: { $in: exampleDealTitles as any },
    })
    if (already > 0) {
      return false
    }
  }

  await seedCustomerDictionaries(em, { tenantId, organizationId })

  const seededIndustryValues = new Set(
    CUSTOMER_EXAMPLES.map((company) => (typeof company.industry === 'string' ? company.industry.trim() : ''))
      .filter((value): value is string => value.length > 0)
  )
  for (const value of seededIndustryValues) {
    await ensureDictionaryEntry(em, {
      tenantId,
      organizationId,
      kind: 'industry',
      value,
      label: value,
    })
  }

  let cache: CacheStrategy | null = null
  if (typeof (container as any).hasRegistration === 'function' && container.hasRegistration('cache')) {
    try {
      cache = (container.resolve('cache') as CacheStrategy)
    } catch {
      cache = null
    }
  }
  try {
    await installCustomEntitiesFromModules(em, cache, {
      tenantIds: [tenantId],
      includeGlobal: false,
      dryRun: false,
      logger: () => {},
    })
  } catch (err) {
    console.warn('[customers.cli] Failed to install custom entities before seeding examples', err)
  }

  try {
    await ensureCustomFieldDefinitions(
      em,
      CUSTOMER_CUSTOM_FIELD_SETS,
      { organizationId: null, tenantId }
    )
  } catch (err) {
    console.warn('[customers.cli] Failed to ensure customer custom field definitions', err)
  }

  const dataEngine = new DefaultDataEngine(em, container)
  const customFieldAssignments: Array<() => Promise<void>> = []

  const companyEntities = new Map<string, CustomerEntity>()
  const personEntities = new Map<string, CustomerEntity>()

  for (const company of CUSTOMER_EXAMPLES) {
    const companyEntity = em.create(CustomerEntity, {
      organizationId,
      tenantId,
      kind: 'company',
      displayName: company.displayName,
      description: company.description ?? null,
      primaryEmail: company.primaryEmail ?? null,
      primaryPhone: company.primaryPhone ?? null,
      lifecycleStage: company.lifecycleStage ?? null,
      status: company.status ?? null,
      source: company.source ?? null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const companyProfile = em.create(CustomerCompanyProfile, {
      organizationId,
      tenantId,
      entity: companyEntity,
      legalName: company.legalName ?? null,
      brandName: company.brandName ?? null,
      domain: company.domain ?? null,
      websiteUrl: company.websiteUrl ?? null,
      industry: typeof company.industry === 'string' ? company.industry.trim() || null : null,
      sizeBucket: company.sizeBucket ?? null,
      annualRevenue: typeof company.annualRevenue === 'number' ? toAmount(company.annualRevenue) : null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(companyEntity)
    em.persist(companyProfile)

    if (company.custom && Object.keys(company.custom).length) {
      const values = { ...company.custom } as CustomFieldValuesPayload
      customFieldAssignments.push(async () =>
        dataEngine.setCustomFields({
          entityId: CoreEntities.customers.customer_company_profile,
          recordId: companyProfile.id,
          organizationId,
          tenantId,
          values,
        })
      )
    }

    if (company.address?.addressLine1) {
      const address = em.create(CustomerAddress, {
        organizationId,
        tenantId,
        entity: companyEntity,
        name: company.address.name ?? null,
        purpose: company.address.purpose ?? 'office',
        addressLine1: company.address.addressLine1,
        addressLine2: company.address.addressLine2 ?? null,
        city: company.address.city ?? null,
        region: company.address.region ?? null,
        postalCode: company.address.postalCode ?? null,
        country: company.address.country ?? null,
        latitude: company.address.latitude ?? null,
        longitude: company.address.longitude ?? null,
        buildingNumber: company.address.buildingNumber ?? null,
        flatNumber: company.address.flatNumber ?? null,
        isPrimary: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(address)
    }

    companyEntities.set(company.slug, companyEntity)

    for (const person of company.people ?? []) {
      const nameParts = [person.firstName, person.lastName].filter((part) => !!part && part.trim().length)
      const displayName = nameParts.length ? nameParts.join(' ') : person.email
      const personEntity = em.create(CustomerEntity, {
        organizationId,
        tenantId,
        kind: 'person',
        displayName,
        description: person.description ?? null,
        primaryEmail: person.email,
        primaryPhone: person.phone ?? null,
      lifecycleStage: company.lifecycleStage ?? null,
      status: 'active',
      source: person.source ?? company.source ?? null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
      const personProfile = em.create(CustomerPersonProfile, {
        organizationId,
        tenantId,
        entity: personEntity,
        company: companyEntity,
        firstName: person.firstName,
        lastName: person.lastName,
        preferredName: person.preferredName ?? null,
        jobTitle: person.jobTitle ?? null,
        department: person.department ?? null,
        seniority: person.seniority ?? null,
        timezone: person.timezone ?? null,
        linkedInUrl: person.linkedInUrl ?? null,
        twitterUrl: person.twitterUrl ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(personEntity)
      em.persist(personProfile)

      if (person.custom && Object.keys(person.custom).length) {
        const values = { ...person.custom } as CustomFieldValuesPayload
        customFieldAssignments.push(async () =>
          dataEngine.setCustomFields({
            entityId: CoreEntities.customers.customer_person_profile,
            recordId: personProfile.id,
            organizationId,
            tenantId,
            values,
          })
        )
      }

      if (person.address?.addressLine1) {
        const address = em.create(CustomerAddress, {
          organizationId,
          tenantId,
          entity: personEntity,
          name: person.address.name ?? null,
          purpose: person.address.purpose ?? 'work',
          addressLine1: person.address.addressLine1,
          addressLine2: person.address.addressLine2 ?? null,
          city: person.address.city ?? null,
          region: person.address.region ?? null,
          postalCode: person.address.postalCode ?? null,
          country: person.address.country ?? null,
          latitude: person.address.latitude ?? null,
          longitude: person.address.longitude ?? null,
          buildingNumber: person.address.buildingNumber ?? null,
          flatNumber: person.address.flatNumber ?? null,
          isPrimary: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        em.persist(address)
      }

      personEntities.set(person.slug, personEntity)
    }

    for (const interaction of company.interactions ?? []) {
      const targetEntity =
        interaction.entity === 'person' && interaction.personSlug
          ? personEntities.get(interaction.personSlug)
          : companyEntity
      if (!targetEntity) continue
      const activity = em.create(CustomerActivity, {
        organizationId,
        tenantId,
        entity: targetEntity,
        deal: null,
        activityType: interaction.type,
        subject: interaction.subject ?? null,
        body: interaction.body ?? null,
        occurredAt: interaction.occurredAt ? new Date(interaction.occurredAt) : null,
        appearanceIcon: interaction.icon ?? null,
        appearanceColor: interaction.color ?? null,
        authorUserId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(activity)

      if (interaction.custom && Object.keys(interaction.custom).length) {
        const values = { ...interaction.custom } as CustomFieldValuesPayload
        customFieldAssignments.push(async () =>
          dataEngine.setCustomFields({
            entityId: CoreEntities.customers.customer_activity,
            recordId: activity.id,
            organizationId,
            tenantId,
            values,
          })
        )
      }
    }

    for (const note of company.notes ?? []) {
      const targetEntity =
        note.entity === 'person' && note.personSlug ? personEntities.get(note.personSlug) : companyEntity
      if (!targetEntity) continue
      const comment = em.create(CustomerComment, {
        organizationId,
        tenantId,
        entity: targetEntity,
        deal: null,
        body: note.body,
        authorUserId: null,
        appearanceIcon: note.icon ?? null,
        appearanceColor: note.color ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      if (note.occurredAt) {
        const timestamp = new Date(note.occurredAt)
        if (!Number.isNaN(timestamp.getTime())) {
          comment.createdAt = timestamp
          comment.updatedAt = timestamp
        }
      }
      em.persist(comment)
    }
  }

  for (const company of CUSTOMER_EXAMPLES) {
    const companyEntity = companyEntities.get(company.slug)
    if (!companyEntity) continue
    for (const dealInfo of company.deals ?? []) {
      const deal = em.create(CustomerDeal, {
        organizationId,
        tenantId,
        title: dealInfo.title,
        description: dealInfo.description ?? null,
        status: dealInfo.status,
        pipelineStage: dealInfo.pipelineStage ?? null,
        valueAmount: toAmount(dealInfo.valueAmount),
        valueCurrency:
          dealInfo.valueCurrency ?? (typeof dealInfo.valueAmount === 'number' ? 'USD' : null),
        probability:
          typeof dealInfo.probability === 'number' ? Math.round(dealInfo.probability) : null,
        expectedCloseAt: dealInfo.expectedCloseAt ? new Date(dealInfo.expectedCloseAt) : null,
        ownerUserId: null,
        source: dealInfo.source ?? company.source ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(deal)

      if (dealInfo.custom && Object.keys(dealInfo.custom).length) {
        const values = { ...dealInfo.custom } as CustomFieldValuesPayload
        customFieldAssignments.push(async () =>
          dataEngine.setCustomFields({
            entityId: CoreEntities.customers.customer_deal,
            recordId: deal.id,
            organizationId,
            tenantId,
            values,
          })
        )
      }

      const companyLink = em.create(CustomerDealCompanyLink, {
        deal,
        company: companyEntity,
        createdAt: new Date(),
      })
      em.persist(companyLink)

      for (const participant of dealInfo.people ?? []) {
        const personEntity = personEntities.get(participant.slug)
        if (!personEntity) continue
        const link = em.create(CustomerDealPersonLink, {
          deal,
          person: personEntity,
          participantRole: participant.participantRole ?? null,
          createdAt: new Date(),
        })
        em.persist(link)
      }

      for (const activityInfo of dealInfo.activities ?? []) {
        const targetEntity =
          activityInfo.entity === 'person' && activityInfo.personSlug
            ? personEntities.get(activityInfo.personSlug)
            : companyEntity
        if (!targetEntity) continue
        const activity = em.create(CustomerActivity, {
          organizationId,
          tenantId,
          entity: targetEntity,
          deal,
          activityType: activityInfo.type,
          subject: activityInfo.subject ?? null,
          body: activityInfo.body ?? null,
          occurredAt: activityInfo.occurredAt ? new Date(activityInfo.occurredAt) : null,
          appearanceIcon: activityInfo.icon ?? null,
          appearanceColor: activityInfo.color ?? null,
          authorUserId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        em.persist(activity)

        if (activityInfo.custom && Object.keys(activityInfo.custom).length) {
          const values = { ...activityInfo.custom } as CustomFieldValuesPayload
          customFieldAssignments.push(async () =>
            dataEngine.setCustomFields({
              entityId: CoreEntities.customers.customer_activity,
              recordId: activity.id,
              organizationId,
              tenantId,
              values,
            })
          )
        }
      }
    }
  }

  await em.flush()

  for (const assign of customFieldAssignments) {
    try {
      await assign()
    } catch (err) {
      console.warn('[customers.cli] Failed to set custom fields for seeded record', err)
    }
  }

  return true
}

async function seedCustomerStressTest(
  em: EntityManager,
  container: AppContainer,
  { tenantId, organizationId }: SeedArgs,
  options: StressTestOptions
): Promise<{ created: number; existing: number }> {
  const requested = Math.max(0, Math.floor(options.count ?? 0))
  if (requested <= 0) return { created: 0, existing: 0 }

  const includeExtras = options.includeExtras !== false

  const existingPersons = await em.count(CustomerEntity, {
    tenantId,
    organizationId,
    kind: 'person',
    source: STRESS_TEST_SOURCE,
  })

  if (existingPersons >= requested) {
    options.onProgress?.({ completed: 0, total: 0 })
    return { created: 0, existing: existingPersons }
  }

  const toCreate = requested - existingPersons
  const statusOptions = ENTITY_STATUS_DEFAULTS.map((entry) => entry.value)
  const lifecycleOptions = ENTITY_LIFECYCLE_STAGE_DEFAULTS.map((entry) => entry.value)
  const companyCount = Math.max(1, Math.min(toCreate, Math.round(toCreate / 3)))

  const total = toCreate
  options.onProgress?.({ completed: 0, total })
  const startedAt = Date.now()

  await seedCustomerDictionaries(em, { tenantId, organizationId })

  let cache: CacheStrategy | null = null
  if (includeExtras) {
    if (typeof (container as any).hasRegistration === 'function' && container.hasRegistration('cache')) {
      try {
        cache = (container.resolve('cache') as CacheStrategy)
      } catch {
        cache = null
      }
    }
    try {
      await installCustomEntitiesFromModules(em, cache, {
        tenantIds: [tenantId],
        includeGlobal: false,
        dryRun: false,
        logger: () => {},
      })
    } catch (err) {
      console.warn('[customers.cli] Failed to install custom entities before stress-test seeding', err)
    }
    try {
      await ensureCustomFieldDefinitions(em, CUSTOMER_CUSTOM_FIELD_SETS, { organizationId: null, tenantId })
    } catch (err) {
      console.warn('[customers.cli] Failed to ensure custom field definitions for stress-test seeding', err)
    }
  }

  type Primitive = string | number | boolean | null | undefined

  type PendingCustomFieldAssignment = {
    entityId: string
    organizationId: string | null
    tenantId: string | null
    values: Record<string, Primitive | Primitive[] | undefined>
    getRecordId: () => string | undefined
    registeredForIndex?: boolean
  }

  type CustomFieldInsertRow = {
    entityId: string
    recordId: string
    organizationId: string | null
    tenantId: string | null
    fieldKey: string
    valueText?: string | null
    valueMultiline?: string | null
    valueInt?: number | null
    valueFloat?: number | null
    valueBool?: boolean | null
  }

  const pendingAssignments: PendingCustomFieldAssignment[] = []
  const cfRowBuffer: CustomFieldInsertRow[] = []
  const assignmentFlushThreshold = includeExtras ? 100 : 0
  const cfInsertBatchSize = 500
  const flushInterval = 100
  const knex = em.getConnection().getKnex()
  const entityIndexesColumns = await knex('entity_indexes')
    .columnInfo()
    .catch(() => ({} as Record<string, unknown>))
  const hasColumn = (name: string) =>
    Object.keys(entityIndexesColumns).some((col) => col.toLowerCase() === name.toLowerCase())
  const supportsOrgCoalesced = hasColumn('organization_id_coalesced')

  type PendingIndexDoc = {
    entityType: string
    recordId: string
    organizationId: string | null
    tenantId: string | null
    baseRow: Record<string, any>
    customFields: IndexCustomFieldValue[]
    createdAt: Date
    updatedAt: Date
  }

  const pendingIndexDocs = new Map<string, Map<string, PendingIndexDoc>>()

  const ensureIndexDoc = (
    entityType: string,
    recordId: string,
    initializer: () => PendingIndexDoc,
  ): PendingIndexDoc => {
    let bucket = pendingIndexDocs.get(entityType)
    if (!bucket) {
      bucket = new Map<string, PendingIndexDoc>()
      pendingIndexDocs.set(entityType, bucket)
    }
    let doc = bucket.get(recordId)
    if (!doc) {
      doc = initializer()
      bucket.set(recordId, doc)
    }
    return doc
  }

  const registerIndexBaseRow = (entityType: string, row: Record<string, any>) => {
    const recordId = String((row as any).id)
    const createdAt = ((row as any).created_at as Date) ?? new Date()
    const updatedAt = ((row as any).updated_at as Date) ?? createdAt
    const organizationId = ((row as any).organization_id ?? null) as string | null
    const tenantId = ((row as any).tenant_id ?? null) as string | null
    const doc = ensureIndexDoc(entityType, recordId, () => ({
      entityType,
      recordId,
      organizationId,
      tenantId,
      baseRow: { ...row },
      customFields: [],
      createdAt,
      updatedAt,
    }))
    doc.entityType = entityType
    doc.recordId = recordId
    doc.organizationId = organizationId
    doc.tenantId = tenantId
    doc.baseRow = { ...row }
    doc.createdAt = createdAt
    doc.updatedAt = updatedAt
  }

  const appendIndexCustomFields = (
    entityType: string,
    recordId: string,
    scope: { organizationId: string | null; tenantId: string | null },
    values: Record<string, Primitive | Primitive[] | undefined>,
  ) => {
    const doc = ensureIndexDoc(entityType, recordId, () => ({
      entityType,
      recordId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      baseRow: {},
      customFields: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
    doc.organizationId = scope.organizationId
    doc.tenantId = scope.tenantId
    for (const [key, raw] of Object.entries(values)) {
      if (raw === undefined) continue
      const pushValue = (value: Primitive) => {
        doc.customFields.push({
          key,
          value: value ?? null,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
        })
      }
      if (Array.isArray(raw)) {
        for (const entry of raw as Primitive[]) pushValue(entry)
      } else {
        pushValue(raw as Primitive)
      }
    }
  }

  const flushIndexDocs = async (trx: any) => {
    const rows: Array<{
      entity_type: string
      entity_id: string
      organization_id: string | null
      tenant_id: string | null
      doc: Record<string, unknown>
      index_version: number
      created_at: Date
      updated_at: Date
      deleted_at: null
    }> = []
    for (const [entityType, bucket] of pendingIndexDocs.entries()) {
      for (const entry of bucket.values()) {
        if (!entry.baseRow || Object.keys(entry.baseRow).length === 0) continue
        rows.push({
          entity_type: entityType,
          entity_id: entry.recordId,
          organization_id: entry.organizationId,
          tenant_id: entry.tenantId,
          doc: buildIndexDocument(entry.baseRow, entry.customFields, {
            organizationId: entry.organizationId,
            tenantId: entry.tenantId,
          }),
          index_version: 1,
          created_at: entry.createdAt,
          updated_at: entry.updatedAt,
          deleted_at: null,
        })
      }
      bucket.clear()
    }
    if (!rows.length) {
      pendingIndexDocs.clear()
      return
    }
    if (supportsOrgCoalesced) {
      await trx('entity_indexes')
        .insert(rows)
        .onConflict(['entity_type', 'entity_id', 'organization_id_coalesced'])
        .merge({
          doc: trx.raw('excluded.doc'),
          index_version: trx.raw('excluded.index_version'),
          organization_id: trx.raw('excluded.organization_id'),
          tenant_id: trx.raw('excluded.tenant_id'),
          deleted_at: trx.raw('excluded.deleted_at'),
          updated_at: trx.raw('excluded.updated_at'),
        })
    } else {
      for (const row of rows) {
        const updatePayload = {
          doc: row.doc,
          index_version: row.index_version,
          organization_id: row.organization_id,
          tenant_id: row.tenant_id,
          updated_at: row.updated_at,
          deleted_at: null as null,
        }
        const updated = await trx('entity_indexes')
          .where({
            entity_type: row.entity_type,
            entity_id: row.entity_id,
            organization_id: row.organization_id,
          })
          .update(updatePayload)
        if (updated) continue
        try {
          await trx('entity_indexes').insert(row)
        } catch {
          // ignored: row inserted concurrently
        }
      }
    }
    pendingIndexDocs.clear()
  }

  const queueCustomFieldAssignment = (assignment: PendingCustomFieldAssignment) => {
    if (!includeExtras) return
    const recordId = assignment.getRecordId()
    if (recordId) {
      appendIndexCustomFields(
        assignment.entityId,
        recordId,
        { organizationId: assignment.organizationId ?? null, tenantId: assignment.tenantId ?? null },
        assignment.values,
      )
      assignment.registeredForIndex = true
    }
    pendingAssignments.push(assignment)
  }

  const appendRow = (row: CustomFieldInsertRow) => {
    cfRowBuffer.push(row)
  }

  const materializeAssignments = () => {
    if (!pendingAssignments.length) return
    for (const assignment of pendingAssignments.splice(0)) {
      const recordId = assignment.getRecordId()
      if (!recordId) continue
      if (!assignment.registeredForIndex) {
        appendIndexCustomFields(
          assignment.entityId,
          recordId,
          { organizationId: assignment.organizationId ?? null, tenantId: assignment.tenantId ?? null },
          assignment.values,
        )
        assignment.registeredForIndex = true
      }
      for (const [fieldKey, raw] of Object.entries(assignment.values)) {
        if (raw === undefined) continue
        if (Array.isArray(raw)) {
          for (const val of raw as Primitive[]) {
            appendRow(buildCustomFieldRow(assignment, recordId, fieldKey, val))
          }
        } else {
          appendRow(buildCustomFieldRow(assignment, recordId, fieldKey, raw))
        }
      }
    }
  }

  const buildCustomFieldRow = (
    assignment: PendingCustomFieldAssignment,
    recordId: string,
    fieldKey: string,
    value: Primitive
  ): CustomFieldInsertRow => {
    const base: CustomFieldInsertRow = {
      entityId: assignment.entityId,
      recordId,
      organizationId: assignment.organizationId ?? null,
      tenantId: assignment.tenantId ?? null,
      fieldKey,
    }
    if (value === null || value === undefined) {
      base.valueText = null
      return base
    }
    if (typeof value === 'boolean') {
      base.valueBool = value
      return base
    }
    if (typeof value === 'number') {
      if (Number.isInteger(value)) base.valueInt = value
      else base.valueFloat = value
      return base
    }
    base.valueText = String(value)
    return base
  }

  const flushCustomFieldRows = async (force: boolean) => {
    if (!includeExtras) return
    if (!force && cfRowBuffer.length < cfInsertBatchSize) return
    if (!cfRowBuffer.length) return
    const chunkSize = cfInsertBatchSize
    while (cfRowBuffer.length) {
      const chunk = cfRowBuffer.splice(0, chunkSize)
      const timestamp = new Date()
      const payload = chunk.map((row) => ({
        entity_id: row.entityId,
        record_id: row.recordId,
        organization_id: row.organizationId,
        tenant_id: row.tenantId,
        field_key: row.fieldKey,
        value_text: row.valueText ?? null,
        value_multiline: row.valueMultiline ?? null,
        value_int: row.valueInt ?? null,
        value_float: row.valueFloat ?? null,
        value_bool: row.valueBool ?? null,
        created_at: timestamp,
        deleted_at: null,
      }))
      await knex.insert(payload).into('custom_field_values')
    }
  }

  const flushAssignments = async (force = false) => {
    if (!includeExtras) {
      if (force) await em.flush()
      return
    }
    if (!force && pendingAssignments.length < assignmentFlushThreshold && cfRowBuffer.length < cfInsertBatchSize) return
    await em.flush()
    materializeAssignments()
    await flushCustomFieldRows(force)
  }

  // bulk insert data structures and generation implemented below

  type CustomerEntityRow = {
    id: string
    organization_id: string
    tenant_id: string
    kind: 'company' | 'person'
    display_name: string
    description: string | null
    owner_user_id: string | null
    primary_email: string | null
    primary_phone: string | null
    status: string | null
    lifecycle_stage: string | null
    source: string | null
    next_interaction_at: Date | null
    next_interaction_name: string | null
    next_interaction_ref_id: string | null
    next_interaction_icon: string | null
    next_interaction_color: string | null
    is_active: boolean
    created_at: Date
    updated_at: Date
    deleted_at: Date | null
  }

  type CustomerCompanyProfileRow = {
    id: string
    organization_id: string
    tenant_id: string
    entity_id: string
    legal_name: string | null
    brand_name: string | null
    domain: string | null
    website_url: string | null
    industry: string | null
    size_bucket: string | null
    annual_revenue: string | null
    created_at: Date
    updated_at: Date
  }

  type CustomerPersonProfileRow = {
    id: string
    organization_id: string
    tenant_id: string
    entity_id: string
    company_entity_id: string | null
    first_name: string | null
    last_name: string | null
    preferred_name: string | null
    job_title: string | null
    department: string | null
    seniority: string | null
    timezone: string | null
    linked_in_url: string | null
    twitter_url: string | null
    created_at: Date
    updated_at: Date
  }

  type CustomerDealRow = {
    id: string
    organization_id: string
    tenant_id: string
    title: string
    description: string | null
    status: string
    pipeline_stage: string | null
    value_amount: string | null
    value_currency: string | null
    probability: number | null
    expected_close_at: Date | null
    owner_user_id: string | null
    source: string | null
    created_at: Date
    updated_at: Date
    deleted_at: Date | null
  }

  type CustomerDealCompanyRow = {
    id: string
    deal_id: string
    company_entity_id: string
    created_at: Date
  }

  type CustomerDealPersonRow = {
    id: string
    deal_id: string
    person_entity_id: string
    role: string | null
    created_at: Date
  }

  type CustomerActivityRow = {
    id: string
    organization_id: string
    tenant_id: string
    entity_id: string
    deal_id: string | null
    activity_type: string
    subject: string | null
    body: string | null
    occurred_at: Date | null
    author_user_id: string | null
    appearance_icon: string | null
    appearance_color: string | null
    created_at: Date
    updated_at: Date
  }

  type CustomerCommentRow = {
    id: string
    organization_id: string
    tenant_id: string
    entity_id: string
    deal_id: string | null
    body: string
    author_user_id: string | null
    appearance_icon: string | null
    appearance_color: string | null
    created_at: Date
    updated_at: Date
    deleted_at: Date | null
  }

  type CompanyRecord = {
    entityId: string
    companyProfileId: string
    status: string | null
    lifecycleStage: string | null
    source: string | null
    displayName: string
  }

  const customerEntityRows: CustomerEntityRow[] = []
  const companyProfileRows: CustomerCompanyProfileRow[] = []
  const personProfileRows: CustomerPersonProfileRow[] = []
  const dealRows: CustomerDealRow[] = []
  const dealCompanyRows: CustomerDealCompanyRow[] = []
  const dealPersonRows: CustomerDealPersonRow[] = []
  const activityRows: CustomerActivityRow[] = []
  const commentRows: CustomerCommentRow[] = []
  const companies: CompanyRecord[] = []
  const entityInsertBatchSize = 1000
  const contactsPerCompany = Math.max(1, Math.ceil(toCreate / companyCount))

  await warnIfStressTestSchemaChanged(knex)

  const insertRows = async (trx: any, table: string, rows: unknown[]) => {
    if (!rows.length) return
    await trx.batchInsert(table, rows, entityInsertBatchSize)
    rows.length = 0
  }

  const flushEntityRows = async (force = false) => {
    if (!force) return
    const pendingCount =
      customerEntityRows.length +
      companyProfileRows.length +
      personProfileRows.length +
      dealRows.length +
      dealCompanyRows.length +
      dealPersonRows.length +
      activityRows.length +
      commentRows.length
    if (pendingCount === 0) return
    await knex.transaction(async (trx) => {
      await insertRows(trx, 'customer_entities', customerEntityRows)
      await insertRows(trx, 'customer_companies', companyProfileRows)
      await insertRows(trx, 'customer_people', personProfileRows)
      if (includeExtras) {
        await insertRows(trx, 'customer_deals', dealRows)
        await insertRows(trx, 'customer_deal_companies', dealCompanyRows)
        await insertRows(trx, 'customer_deal_people', dealPersonRows)
        await insertRows(trx, 'customer_activities', activityRows)
        await insertRows(trx, 'customer_comments', commentRows)
      }
      await flushIndexDocs(trx)
    })
  }

  const createCompanyRecord = (): CompanyRecord => {
    const companyId = randomUUID()
    const profileId = randomUUID()
    const status = randomChoice(statusOptions)
    const lifecycleStage = randomChoice(lifecycleOptions)
    const prefix = randomChoice(STRESS_TEST_COMPANY_PREFIX)
    const suffix = randomChoice(STRESS_TEST_COMPANY_SUFFIX)
    const baseName = `${prefix} ${suffix}`
    const sequence = existingPersons + companies.length + 1
    const displayName = `${baseName} ${sequence}`
    const domainBase = slugifyValue(`${prefix}-${suffix}-${sequence}`) || `company-${sequence}`
    const domain = `${domainBase}.${STRESS_TEST_EMAIL_DOMAIN}`
    const websiteUrl = `https://www.${domain}`
    const primaryEmail = `hello@${domain}`
    const primaryPhone = buildPhone(sequence)
    const timestamp = new Date()
    const entityRow: CustomerEntityRow = {
      id: companyId,
      organization_id: organizationId,
      tenant_id: tenantId,
      kind: 'company',
      display_name: displayName,
      description: `Stress test company #${sequence}`,
      owner_user_id: null,
      primary_email: primaryEmail,
      primary_phone: primaryPhone,
      status,
      lifecycle_stage: lifecycleStage,
      source: STRESS_TEST_SOURCE,
      next_interaction_at: null,
      next_interaction_name: null,
      next_interaction_ref_id: null,
      next_interaction_icon: null,
      next_interaction_color: null,
      is_active: true,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
    }
    customerEntityRows.push(entityRow)
    registerIndexBaseRow(CoreEntities.customers.customer_entity, entityRow)
    const profileRow: CustomerCompanyProfileRow = {
      id: profileId,
      organization_id: organizationId,
      tenant_id: tenantId,
      entity_id: companyId,
      legal_name: `${displayName} LLC`,
      brand_name: baseName,
      domain,
      website_url: websiteUrl,
      industry: randomChoice(STRESS_TEST_INDUSTRIES),
      size_bucket: randomChoice(STRESS_TEST_SIZE_BUCKETS),
      annual_revenue: null,
      created_at: timestamp,
      updated_at: timestamp,
    }
    companyProfileRows.push(profileRow)
    registerIndexBaseRow(CoreEntities.customers.customer_company_profile, profileRow)
    const record: CompanyRecord = {
      entityId: companyId,
      companyProfileId: profileId,
      status,
      lifecycleStage,
      source: STRESS_TEST_SOURCE,
      displayName,
    }
    if (includeExtras) {
      const companyFieldValues: Record<string, Primitive | Primitive[]> = {
        relationship_health: randomChoice(STRESS_TEST_RELATIONSHIP_HEALTH),
        renewal_quarter: randomChoice(STRESS_TEST_RENEWAL_QUARTERS),
        customer_marketing_case: Math.random() < 0.35,
      }
      if (Math.random() < 0.4) companyFieldValues.executive_notes = randomChoice(STRESS_TEST_NOTE_SNIPPETS)
      queueCustomFieldAssignment({
        entityId: CoreEntities.customers.customer_company_profile,
        organizationId,
        tenantId,
        values: companyFieldValues,
        getRecordId: () => profileId,
      })
    }
    companies.push(record)
    return record
  }

  let created = 0
  for (let i = 0; i < toCreate; i += 1) {
    const desiredCompanyIndex = Math.floor(i / contactsPerCompany)
    while (companies.length <= desiredCompanyIndex && companies.length < companyCount) {
      createCompanyRecord()
    }
    const companyRecord =
      companies[Math.min(desiredCompanyIndex, companies.length - 1)] ?? createCompanyRecord()

    const sequence = existingPersons + i + 1
    const timestamp = new Date()
    const firstName = randomChoice(STRESS_TEST_FIRST_NAMES)
    const lastName = randomChoice(STRESS_TEST_LAST_NAMES)
    const displayName = `${firstName} ${lastName}`
    const emailHandle = slugifyValue(`${firstName}.${lastName}`) || `contact-${sequence}`
    const email = `${emailHandle}.${sequence}@${STRESS_TEST_EMAIL_DOMAIN}`
    const timezone = randomChoice(STRESS_TEST_TIMEZONES)
    const personEntityId = randomUUID()
    const personEntityRow: CustomerEntityRow = {
      id: personEntityId,
      organization_id: organizationId,
      tenant_id: tenantId,
      kind: 'person',
      display_name: displayName,
      description: `Stress test contact #${sequence}`,
      owner_user_id: null,
      primary_email: email,
      primary_phone: buildPhone(sequence),
      status: companyRecord.status,
      lifecycle_stage: companyRecord.lifecycleStage,
      source: companyRecord.source,
      next_interaction_at: null,
      next_interaction_name: null,
      next_interaction_ref_id: null,
      next_interaction_icon: null,
      next_interaction_color: null,
      is_active: true,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
    }
    customerEntityRows.push(personEntityRow)
    registerIndexBaseRow(CoreEntities.customers.customer_entity, personEntityRow)
    const personProfileId = randomUUID()
    const personProfileRow: CustomerPersonProfileRow = {
      id: personProfileId,
      organization_id: organizationId,
      tenant_id: tenantId,
      entity_id: personEntityId,
      company_entity_id: companyRecord.entityId,
      first_name: firstName,
      last_name: lastName,
      preferred_name: firstName,
      job_title: randomChoice(STRESS_TEST_JOB_TITLES),
      department: randomChoice(STRESS_TEST_DEPARTMENTS),
      seniority: randomChoice(STRESS_TEST_SENIORITY),
      timezone,
      linked_in_url: `https://www.linkedin.com/in/${emailHandle}${sequence}`,
      twitter_url: `https://twitter.com/${emailHandle}${sequence}`,
      created_at: timestamp,
      updated_at: timestamp,
    }
    personProfileRows.push(personProfileRow)
    registerIndexBaseRow(CoreEntities.customers.customer_person_profile, personProfileRow)

    if (includeExtras) {
      const personFieldValues: Record<string, Primitive | Primitive[]> = {
        buying_role: randomChoice(STRESS_TEST_BUYING_ROLES),
        preferred_pronouns: randomChoice(STRESS_TEST_PRONOUNS),
        newsletter_opt_in: Math.random() < 0.5,
      }
      queueCustomFieldAssignment({
        entityId: CoreEntities.customers.customer_person_profile,
        organizationId,
        tenantId,
        values: personFieldValues,
        getRecordId: () => personProfileId,
      })

      const monetaryBase = randomInt(5, 220) * 1000
      const pipelineStage = randomChoice(STRESS_TEST_DEAL_PIPELINE)
      const dealStatus = randomChoice(STRESS_TEST_DEAL_STATUSES)
      const dealId = randomUUID()
      const valueAmount = toAmount(monetaryBase + randomInt(0, 7500))
      const expectedCloseAt =
        dealStatus === 'win' || dealStatus === 'closed' || dealStatus === 'loose'
          ? randomPastDate(120)
          : randomFutureDate(120)
      const dealRow: CustomerDealRow = {
        id: dealId,
        organization_id: organizationId,
        tenant_id: tenantId,
        title: `${companyRecord.displayName} Opportunity ${sequence}`,
        description: `Stress test deal generated for contact #${sequence}`,
        status: dealStatus,
        pipeline_stage: pipelineStage ?? null,
        value_amount: valueAmount,
        value_currency: Math.random() < 0.6 ? 'USD' : 'EUR',
        probability: randomInt(25, 95),
        expected_close_at: expectedCloseAt,
        owner_user_id: null,
        source: companyRecord.source,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null,
      }
      dealRows.push(dealRow)
      registerIndexBaseRow(CoreEntities.customers.customer_deal, dealRow)
      dealCompanyRows.push({
        id: randomUUID(),
        deal_id: dealId,
        company_entity_id: companyRecord.entityId,
        created_at: timestamp,
      })
      dealPersonRows.push({
        id: randomUUID(),
        deal_id: dealId,
        person_entity_id: personEntityId,
        role: randomChoice(STRESS_TEST_DEAL_CUSTOMER_ROLES),
        created_at: timestamp,
      })

      queueCustomFieldAssignment({
        entityId: CoreEntities.customers.customer_deal,
        organizationId,
        tenantId,
        values: {
          competitive_risk: randomChoice(STRESS_TEST_DEAL_RISK),
          implementation_complexity: randomChoice(STRESS_TEST_IMPLEMENTATION),
          estimated_seats: randomInt(5, 250),
          requires_legal_review: Math.random() < 0.3,
        },
        getRecordId: () => dealId,
      })

      const activityCount = randomInt(2, 5)
      for (let idx = 0; idx < activityCount; idx += 1) {
        const activityType = randomChoice(STRESS_TEST_DEAL_ACTIVITY_TYPES)
        const activityId = randomUUID()
        const targetEntityId = activityType === 'person' ? personEntityId : companyRecord.entityId
        const occurredAt = randomPastDate(200)
        const activityRow: CustomerActivityRow = {
          id: activityId,
          organization_id: organizationId,
          tenant_id: tenantId,
          entity_id: targetEntityId,
          deal_id: dealId,
          activity_type: activityType,
          subject: randomChoice(STRESS_TEST_ACTIVITY_SUBJECTS),
          body: randomChoice(STRESS_TEST_ACTIVITY_BODIES),
          occurred_at: occurredAt,
          author_user_id: null,
          appearance_icon: randomChoice(STRESS_TEST_ACTIVITY_ICONS),
          appearance_color: randomChoice(['#2563eb', '#22c55e', '#f97316', '#a855f7', '#6366f1']),
          created_at: timestamp,
          updated_at: timestamp,
        }
        activityRows.push(activityRow)
        registerIndexBaseRow(CoreEntities.customers.customer_activity, activityRow)

        queueCustomFieldAssignment({
          entityId: CoreEntities.customers.customer_activity,
          organizationId,
          tenantId,
          values: {
            engagement_sentiment: randomChoice(STRESS_TEST_ACTIVITY_SENTIMENT),
            shared_with_leadership: Math.random() < 0.4,
            follow_up_owner: randomChoice(STRESS_TEST_ACTIVITY_OWNERS),
          },
          getRecordId: () => activityId,
        })
      }

      const noteCount = randomInt(2, 5)
      for (let idx = 0; idx < noteCount; idx += 1) {
        const noteTimestamp = randomPastDate(120)
        commentRows.push({
          id: randomUUID(),
          organization_id: organizationId,
          tenant_id: tenantId,
          entity_id: personEntityId,
          deal_id: dealId,
          body: randomChoice(STRESS_TEST_NOTE_SNIPPETS),
          author_user_id: null,
          appearance_icon: 'lucide:sticky-note',
          appearance_color: randomChoice(['#2563eb', '#22c55e', '#f97316', '#a855f7', '#6366f1']),
          created_at: noteTimestamp,
          updated_at: noteTimestamp,
          deleted_at: null,
        })
      }
    }

    created += 1
    const shouldFlush = created % flushInterval === 0
    if (shouldFlush) await flushEntityRows(true)
    options.onProgress?.({ completed: created, total })
    if (shouldFlush) await flushAssignments(true)
    else await flushAssignments()
  }

  await flushEntityRows(true)
  await flushAssignments(true)
  options.onProgress?.({ completed: total, total })
  const elapsedMs = Math.max(1, Date.now() - startedAt)
  const recordsPerSecond = toCreate > 0 ? (toCreate / elapsedMs) * 1000 : 0
  console.log(
    `⚡ Stress test seeding throughput: ${toCreate.toLocaleString()} records in ${(elapsedMs / 1000).toFixed(
      1
    )}s (${recordsPerSecond.toFixed(1)} records/s${includeExtras ? '' : ' - lite mode'})`
  )

  return { created: toCreate, existing: existingPersons }
}


const STRESS_TEST_REQUIRED_COLUMNS: Record<string, readonly string[]> = {
  customer_entities: [
    'id',
    'organization_id',
    'tenant_id',
    'kind',
    'display_name',
    'description',
    'owner_user_id',
    'primary_email',
    'primary_phone',
    'status',
    'lifecycle_stage',
    'source',
    'next_interaction_at',
    'next_interaction_name',
    'next_interaction_ref_id',
    'next_interaction_icon',
    'next_interaction_color',
    'is_active',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
  customer_companies: [
    'id',
    'organization_id',
    'tenant_id',
    'entity_id',
    'legal_name',
    'brand_name',
    'domain',
    'website_url',
    'industry',
    'size_bucket',
    'annual_revenue',
    'created_at',
    'updated_at',
  ],
  customer_people: [
    'id',
    'organization_id',
    'tenant_id',
    'first_name',
    'last_name',
    'preferred_name',
    'job_title',
    'department',
    'seniority',
    'timezone',
    'linked_in_url',
    'twitter_url',
    'created_at',
    'updated_at',
    'entity_id',
    'company_entity_id',
  ],
  customer_deals: [
    'id',
    'organization_id',
    'tenant_id',
    'title',
    'description',
    'status',
    'pipeline_stage',
    'value_amount',
    'value_currency',
    'probability',
    'expected_close_at',
    'owner_user_id',
    'source',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
  customer_deal_companies: ['id', 'deal_id', 'company_entity_id', 'created_at'],
  customer_deal_people: ['id', 'deal_id', 'person_entity_id', 'role', 'created_at'],
  customer_activities: [
    'id',
    'organization_id',
    'tenant_id',
    'entity_id',
    'deal_id',
    'activity_type',
    'subject',
    'body',
    'occurred_at',
    'author_user_id',
    'appearance_icon',
    'appearance_color',
    'created_at',
    'updated_at',
  ],
  customer_comments: [
    'id',
    'organization_id',
    'tenant_id',
    'entity_id',
    'deal_id',
    'body',
    'author_user_id',
    'appearance_icon',
    'appearance_color',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
  custom_field_values: [
    'entity_id',
    'record_id',
    'organization_id',
    'tenant_id',
    'field_key',
    'value_text',
    'value_multiline',
    'value_int',
    'value_float',
    'value_bool',
    'created_at',
    'deleted_at',
  ],
}

async function warnIfStressTestSchemaChanged(knex: any) {
  try {
    const warnings: string[] = []
    for (const [table, requiredColumns] of Object.entries(STRESS_TEST_REQUIRED_COLUMNS)) {
      const rows = await knex('information_schema.columns')
        .select('column_name')
        .whereRaw('table_schema = current_schema()')
        .where({ table_name: table })
      const existing = new Set(rows.map((row: { column_name: string }) => row.column_name))
      const missing = requiredColumns.filter((column) => !existing.has(column))
      if (missing.length) warnings.push(`${table}: missing ${missing.join(', ')}`)
    }
    if (warnings.length) {
      console.warn('[customers.cli] Warning: stress-test bulk seeder detected schema differences. Bulk insert path may need updates:')
      warnings.forEach((warning) => console.warn(`  - ${warning}`))
    }
  } catch (err) {
    console.warn('[customers.cli] Warning: unable to verify schema for stress-test bulk seeder', err)
  }
}

const seedDictionaries: ModuleCli = {
  command: 'seed-dictionaries',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.orgId ?? args.org ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato customers seed-dictionaries --tenant <tenantId> --org <organizationId>')
      return
    }
    const { resolve } = await createRequestContainer()
    const em = resolve<EntityManager>('em')
    await em.transactional(async (tem) => {
      await seedCustomerDictionaries(tem, { tenantId, organizationId })
      await seedCurrencyDictionary(tem, { tenantId, organizationId })
      await tem.flush()
    })
    console.log('📚 Customer dictionaries seeded for organization', organizationId)
  },
}

const seedExamples: ModuleCli = {
  command: 'seed-examples',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.orgId ?? args.org ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato customers seed-examples --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager)
    const seeded = await em.transactional(async (tem) =>
      seedCustomerExamples(tem, container, { tenantId, organizationId })
    )
    if (seeded) {
      console.log('Customer example data seeded for organization', organizationId)
    } else {
      console.log('Customer example data already present; skipping')
    }
  },
}

const seedStressTest: ModuleCli = {
  command: 'seed-stresstest',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.orgId ?? args.org ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato customers seed-stresstest --tenant <tenantId> --org <organizationId> [--count <number>] [--lite]')
      return
    }
    const defaultCount = 6000
    const countRaw =
      args.count ?? args.total ?? args.number ?? args.customers ?? String(defaultCount)
    const parsedCount = Number.parseInt(countRaw, 10)
    const count = Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : defaultCount
    const liteFlag = (() => {
      if (typeof args.lite === 'string') {
        if (!args.lite.trim()) return true
        return parseBooleanToken(args.lite) === true
      }
      return false
    })()
    const liteMode =
      liteFlag ||
      args.mode === 'lite' ||
      args.payload === 'lite' ||
      args.variant === 'lite'

    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager)
    let progressBar: ProgressBarHandle | null = null
    const result = await seedCustomerStressTest(
      em,
      container,
      { tenantId, organizationId },
      {
        count,
        includeExtras: !liteMode,
        onProgress: ({ completed, total }) => {
          if (total <= 0) return
          if (!progressBar) {
            const label = liteMode ? 'Generating stress-test customers (lite)' : 'Generating stress-test customers'
            progressBar = createProgressBar(label, total)
          }
          if (progressBar) {
            ;(progressBar as unknown as { update(completed: number): void }).update(completed)
          }
        },
      }
    )
    if (progressBar) {
      ;(progressBar as unknown as { complete(): void }).complete()
    }

    try {
      const eventBus = (container.resolve('eventBus') as any)
      const coverageEntities = [
        CoreEntities.customers.customer_entity,
        CoreEntities.customers.customer_person_profile,
        CoreEntities.customers.customer_company_profile,
      ]
      await Promise.all(
        coverageEntities.map(async (entityType) => {
          await eventBus.emitEvent('query_index.coverage.refresh', {
            entityType,
            tenantId,
            organizationId,
            delayMs: 0,
          })
          await eventBus.emitEvent('query_index.coverage.refresh', {
            entityType,
            tenantId,
            organizationId: null,
            delayMs: 0,
          })
        })
      )
    } catch (err) {
      console.warn('[customers.cli] Failed to refresh query index coverage after stress-test seeding', err)
    }

    if (result.created > 0) {
      console.log(
        `Created ${result.created} stress test customer contacts (existing previously: ${result.existing})`
      )
    } else {
      console.log(
        `Stress test dataset already satisfied (existing contacts: ${result.existing}, requested: ${count})`
      )
    }
  },
}

async function seedDefaultPipeline(em: EntityManager, { tenantId, organizationId }: SeedArgs): Promise<void> {
  const existing = await em.findOne(CustomerPipeline, { tenantId, organizationId, isDefault: true })
  if (existing) return

  const pipeline = em.create(CustomerPipeline, {
    tenantId,
    organizationId,
    name: 'Default Pipeline',
    isDefault: true,
  })
  em.persist(pipeline)
  await em.flush()

  for (let i = 0; i < PIPELINE_STAGE_DEFAULTS.length; i++) {
    const entry = PIPELINE_STAGE_DEFAULTS[i]
    em.persist(em.create(CustomerPipelineStage, {
      tenantId,
      organizationId,
      pipelineId: pipeline.id,
      label: entry.label,
      order: i,
    }))
  }
  await em.flush()
}

export { seedCustomerDictionaries, seedCustomerExamples, seedCustomerStressTest, seedCurrencyDictionary, seedDefaultPipeline }
export type { SeedArgs as CustomerSeedArgs }

const customersCliCommands = [seedDictionaries, seedExamples, seedStressTest]

export default customersCliCommands
const CUSTOMER_CUSTOM_FIELD_SETS = [
  {
    entity: CoreEntities.customers.customer_person_profile,
    fields: [
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
    ],
  },
  {
    entity: CoreEntities.customers.customer_company_profile,
    fields: [
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
    ],
  },
  {
    entity: CoreEntities.customers.customer_deal,
    fields: [
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
    ],
  },
  {
    entity: CoreEntities.customers.customer_activity,
    fields: [
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
    ],
  },
]
