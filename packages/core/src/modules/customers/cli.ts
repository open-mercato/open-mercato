import type { ModuleCli } from '@/modules/registry'
import { createRequestContainer } from '@/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
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

const DEAL_STATUS_DEFAULTS: DictionaryDefault[] = [
  { value: 'open', label: 'Open', color: '#2563eb', icon: 'circle-dot' },
  { value: 'closed', label: 'Closed', color: '#6b7280', icon: 'circle-check' },
  { value: 'win', label: 'Win', color: '#22c55e', icon: 'trophy' },
  { value: 'loose', label: 'Loose', color: '#ef4444', icon: 'x-octagon' },
  { value: 'in_progress', label: 'In progress', color: '#f59e0b', icon: 'loader' },
]

const PIPELINE_STAGE_DEFAULTS: DictionaryDefault[] = [
  { value: 'opportunity', label: 'Opportunity', color: '#38bdf8', icon: 'target' },
  { value: 'marketing_qualified_lead', label: 'Marketing Qualified Lead', color: '#a855f7', icon: 'sparkles' },
  { value: 'sales_qualified_lead', label: 'Sales Qualified Lead', color: '#f97316', icon: 'users' },
  { value: 'offering', label: 'Offering', color: '#22c55e', icon: 'file-text' },
  { value: 'negotiations', label: 'Negotiations', color: '#facc15', icon: 'handshake' },
  { value: 'win', label: 'Win', color: '#16a34a', icon: 'award' },
  { value: 'loose', label: 'Loose', color: '#ef4444', icon: 'x-circle' },
  { value: 'stalled', label: 'Stalled', color: '#6b7280', icon: 'pause-circle' },
]

const ENTITY_STATUS_DEFAULTS: DictionaryDefault[] = [
  { value: 'customer', label: 'Customer', color: '#16a34a', icon: 'handshake' },
  { value: 'active', label: 'Active', color: '#2563eb', icon: 'user-check' },
  { value: 'prospect', label: 'Prospect', color: '#f59e0b', icon: 'user-plus' },
  { value: 'inactive', label: 'Inactive', color: '#6b7280', icon: 'user-x' },
]

const ENTITY_LIFECYCLE_STAGE_DEFAULTS: DictionaryDefault[] = [
  { value: 'prospect', label: 'Prospect', color: '#f59e0b', icon: 'sparkles' },
  { value: 'evaluation', label: 'Evaluation', color: '#a855f7', icon: 'bar-chart-3' },
  { value: 'customer', label: 'Customer', color: '#22c55e', icon: 'handshake' },
  { value: 'expansion', label: 'Expansion', color: '#0ea5e9', icon: 'trending-up' },
  { value: 'churned', label: 'Churned', color: '#ef4444', icon: 'circle-slash' },
]

const ENTITY_SOURCE_DEFAULTS: DictionaryDefault[] = [
  { value: 'partner_referral', label: 'Partner referral', color: '#6366f1', icon: 'users' },
  { value: 'customer_referral', label: 'Customer referral', color: '#22c55e', icon: 'sparkles' },
  { value: 'industry_event', label: 'Industry event', color: '#f97316', icon: 'calendar' },
  { value: 'inbound_web', label: 'Inbound web', color: '#0ea5e9', icon: 'globe' },
  { value: 'outbound_campaign', label: 'Outbound campaign', color: '#facc15', icon: 'megaphone' },
]

const ADDRESS_TYPE_DEFAULTS: DictionaryDefault[] = [
  { value: 'office', label: 'Office', color: '#3b82f6', icon: 'building' },
  { value: 'work', label: 'Work', color: '#6366f1', icon: 'briefcase' },
  { value: 'billing', label: 'Billing', color: '#f97316', icon: 'receipt' },
  { value: 'shipping', label: 'Shipping', color: '#22c55e', icon: 'package' },
  { value: 'home', label: 'Home', color: '#10b981', icon: 'home' },
]

const ACTIVITY_TYPE_DEFAULTS: DictionaryDefault[] = [
  { value: 'call', label: 'Call', color: '#2563eb', icon: 'phone' },
  { value: 'email', label: 'Email', color: '#16a34a', icon: 'mail' },
  { value: 'meeting', label: 'Meeting', color: '#f59e0b', icon: 'users' },
  { value: 'note', label: 'Note', color: '#a855f7', icon: 'file-text' },
  { value: 'task', label: 'Task', color: '#ef4444', icon: 'check-square' },
]

const JOB_TITLE_DEFAULTS: DictionaryDefault[] = [
  { value: 'Director of Operations', label: 'Director of Operations', color: '#f97316', icon: 'settings' },
  { value: 'VP of Partnerships', label: 'VP of Partnerships', color: '#6366f1', icon: 'users' },
  { value: 'Founder & Principal', label: 'Founder & Principal', color: '#ec4899', icon: 'star' },
  { value: 'Senior Project Manager', label: 'Senior Project Manager', color: '#0ea5e9', icon: 'clipboard-list' },
  { value: 'Chief Revenue Officer', label: 'Chief Revenue Officer', color: '#8b5cf6', icon: 'line-chart' },
  { value: 'Director of Retail Partnerships', label: 'Director of Retail Partnerships', color: '#f59e0b', icon: 'shopping-bag' },
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
}

type ExampleDealParticipant = {
  slug: string
  role?: string
}

type ExampleActivity = {
  entity: 'company' | 'person'
  personSlug?: string
  type: string
  subject?: string
  body?: string
  occurredAt: string
  icon?: string
  color?: string
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
      },
    ],
    deals: [
      {
        slug: 'redwood-residences',
        title: 'Redwood Residences Solar Rollout',
        description: '40-home solar installation with ongoing maintenance plan.',
        status: 'in_progress',
        pipelineStage: 'negotiations',
        source: 'partner_referral',
        valueAmount: 185000,
        valueCurrency: 'USD',
        expectedCloseAt: '2024-09-30T00:00:00.000Z',
        probability: 55,
        people: [
          { slug: 'mia-johnson', role: 'Project Sponsor' },
          { slug: 'daniel-cho', role: 'Executive Sponsor' },
        ],
        activities: [
          {
            entity: 'company',
            type: 'call',
            subject: 'Follow-up with HOA board',
            body: 'Reviewed financing options and clarified maintenance service tiers for the board.',
            occurredAt: '2024-07-18T17:30:00.000Z',
            icon: 'phone',
            color: '#2563eb',
          },
          {
            entity: 'person',
            personSlug: 'mia-johnson',
            type: 'note',
            subject: 'Shared case studies',
            body: 'Sent two case studies highlighting 18% average utility bill savings for similar complexes.',
            occurredAt: '2024-07-22T19:15:00.000Z',
            icon: 'file-text',
            color: '#a855f7',
          },
        ],
      },
      {
        slug: 'sunset-lofts-battery',
        title: 'Sunset Lofts Battery Upgrade',
        description: 'Battery upgrade for existing solar customers to extend overnight coverage.',
        status: 'open',
        pipelineStage: 'offering',
        source: 'inbound_web',
        valueAmount: 82000,
        valueCurrency: 'USD',
        expectedCloseAt: '2024-10-20T00:00:00.000Z',
        probability: 40,
        people: [{ slug: 'mia-johnson', role: 'Point of Contact' }],
        activities: [
          {
            entity: 'company',
            type: 'meeting',
            subject: 'On-site energy audit completed',
            body: 'Audit identified 28 units that need inverter firmware updates before batteries ship.',
            occurredAt: '2024-07-10T21:00:00.000Z',
            icon: 'users',
            color: '#f59e0b',
          },
        ],
      },
    ],
    interactions: [
      {
        entity: 'company',
        type: 'email',
        subject: 'Quarterly NPS survey sent',
        body: 'Shared Q2 satisfaction survey with portfolio property managers.',
        occurredAt: '2024-07-05T16:00:00.000Z',
        icon: 'mail',
        color: '#16a34a',
      },
    ],
    notes: [
      {
        entity: 'company',
        body: 'Completed energy audit across 12 HOA buildings; evaluating maintenance bundle add-on.',
        occurredAt: '2024-07-14T18:00:00.000Z',
        icon: 'sun',
        color: '#fbbf24',
      },
      {
        entity: 'person',
        personSlug: 'mia-johnson',
        body: 'Mia requested financing comparison deck before the board vote.',
        occurredAt: '2024-07-18T15:30:00.000Z',
        icon: 'bookmark',
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
      },
    ],
    deals: [
      {
        slug: 'blue-harbor-pilot',
        title: 'Blue Harbor Grocers Pilot Program',
        description: 'Six-month pilot of merchandising analytics across 28 locations.',
        status: 'win',
        pipelineStage: 'win',
        source: 'industry_event',
        valueAmount: 96000,
        valueCurrency: 'USD',
        expectedCloseAt: '2024-06-15T00:00:00.000Z',
        probability: 100,
        people: [
          { slug: 'arjun-patel', role: 'Executive Sponsor' },
          { slug: 'lena-ortiz', role: 'Account Lead' },
        ],
        activities: [
          {
            entity: 'company',
            type: 'meeting',
            subject: 'Contract signed with procurement',
            body: 'Procurement signed SOW; onboarding kickoff scheduled for next Tuesday.',
            occurredAt: '2024-06-11T14:30:00.000Z',
            icon: 'users',
            color: '#f59e0b',
          },
          {
            entity: 'person',
            personSlug: 'lena-ortiz',
            type: 'email',
            subject: 'Shared onboarding checklist',
            body: 'Sent checklist covering data exports and point-of-sale integrations required for go-live.',
            occurredAt: '2024-06-12T13:05:00.000Z',
            icon: 'mail',
            color: '#16a34a',
          },
        ],
      },
      {
        slug: 'midwest-outfitters',
        title: 'Midwest Outfitters Expansion',
        description: 'Expansion opportunity covering 120 stores in the Midwest region.',
        status: 'open',
        pipelineStage: 'opportunity',
        source: 'outbound_campaign',
        valueAmount: 210000,
        valueCurrency: 'USD',
        expectedCloseAt: '2024-12-05T00:00:00.000Z',
        probability: 35,
        people: [{ slug: 'lena-ortiz', role: 'Account Lead' }],
        activities: [
          {
            entity: 'company',
            type: 'call',
            subject: 'Introduced predictive forecasting module',
            body: 'Walkthrough of demand forecasting module with COO and finance controller.',
            occurredAt: '2024-07-08T15:45:00.000Z',
            icon: 'phone',
            color: '#2563eb',
          },
        ],
      },
    ],
    interactions: [
      {
        entity: 'person',
        personSlug: 'arjun-patel',
        type: 'note',
        subject: 'Requested pricing comparison',
        body: 'Arjun asked for pricing comparison versus Qlik ahead of board review.',
        occurredAt: '2024-07-03T12:10:00.000Z',
        icon: 'file-text',
        color: '#a855f7',
      },
    ],
    notes: [
      {
        entity: 'company',
        body: 'Pilot success metrics shared with board; expansion depends on Q4 budget review.',
        occurredAt: '2024-07-06T17:45:00.000Z',
        icon: 'line-chart',
        color: '#38bdf8',
      },
      {
        entity: 'person',
        personSlug: 'lena-ortiz',
        body: 'Lena confirmed data team can supply POS exports within two weeks.',
        occurredAt: '2024-07-09T11:20:00.000Z',
        icon: 'clipboard-list',
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
      },
    ],
    deals: [
      {
        slug: 'wanderstay-renovation',
        title: 'Wanderstay Boutique Renovation',
        description: 'Full lobby and guest suite redesign for the Wanderstay hospitality group.',
        status: 'in_progress',
        pipelineStage: 'sales_qualified_lead',
        source: 'customer_referral',
        valueAmount: 145000,
        valueCurrency: 'USD',
        expectedCloseAt: '2024-08-25T00:00:00.000Z',
        probability: 65,
        people: [
          { slug: 'taylor-brooks', role: 'Principal Designer' },
          { slug: 'naomi-harris', role: 'Project Lead' },
        ],
        activities: [
          {
            entity: 'person',
            personSlug: 'naomi-harris',
            type: 'meeting',
            subject: 'Design workshop recap',
            body: 'Captured lighting and materials feedback from onsite workshop with hospitality team.',
            occurredAt: '2024-07-16T20:00:00.000Z',
            icon: 'users',
            color: '#f59e0b',
          },
        ],
      },
      {
        slug: 'cedar-creek-retreat',
        title: 'Cedar Creek Retreat Expansion',
        description: 'New wellness center build-out including retail area and treatment rooms.',
        status: 'loose',
        pipelineStage: 'loose',
        source: 'customer_referral',
        valueAmount: 98000,
        valueCurrency: 'USD',
        expectedCloseAt: '2024-05-20T00:00:00.000Z',
        probability: 0,
        people: [{ slug: 'taylor-brooks', role: 'Principal Designer' }],
        activities: [
          {
            entity: 'company',
            type: 'note',
            subject: 'Lost due to budget constraints',
            body: 'Retreat selected lower-cost vendor focused on prefabricated interiors.',
            occurredAt: '2024-05-22T18:45:00.000Z',
            icon: 'file-text',
            color: '#a855f7',
          },
        ],
      },
    ],
    interactions: [
      {
        entity: 'company',
        type: 'call',
        subject: 'Referred by Venture Hospitality',
        body: 'Received referral from Venture Hospitality after successful Austin project.',
        occurredAt: '2024-06-27T16:45:00.000Z',
        icon: 'phone',
        color: '#2563eb',
      },
    ],
    notes: [
      {
        entity: 'company',
        body: 'Client interested in sustainable materials library review during next site visit.',
        occurredAt: '2024-06-30T19:10:00.000Z',
        icon: 'leaf',
        color: '#22c55e',
      },
      {
        entity: 'person',
        personSlug: 'naomi-harris',
        body: 'Naomi requested updated FF&E budget before presenting to ownership group.',
        occurredAt: '2024-07-18T21:05:00.000Z',
        icon: 'edit-3',
        color: '#0ea5e9',
      },
    ],
  },
]

function toAmount(value?: number): string | null {
  if (typeof value !== 'number') return null
  return value.toFixed(2)
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
    })
    em.persist(entry)
  }
}

async function seedCustomerExamples(em: EntityManager, { tenantId, organizationId }: SeedArgs): Promise<boolean> {
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
    })
    const companyProfile = em.create(CustomerCompanyProfile, {
      organizationId,
      tenantId,
      entity: companyEntity,
      legalName: company.legalName ?? null,
      brandName: company.brandName ?? null,
      domain: company.domain ?? null,
      websiteUrl: company.websiteUrl ?? null,
      industry: company.industry ?? null,
      sizeBucket: company.sizeBucket ?? null,
      annualRevenue: typeof company.annualRevenue === 'number' ? toAmount(company.annualRevenue) : null,
    })
    em.persist(companyEntity)
    em.persist(companyProfile)

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
      })
      em.persist(personEntity)
      em.persist(personProfile)

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
      })
      em.persist(activity)
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
      })
      em.persist(deal)

      const companyLink = em.create(CustomerDealCompanyLink, {
        deal,
        company: companyEntity,
      })
      em.persist(companyLink)

      for (const participant of dealInfo.people ?? []) {
        const personEntity = personEntities.get(participant.slug)
        if (!personEntity) continue
        const link = em.create(CustomerDealPersonLink, {
          deal,
          person: personEntity,
          role: participant.role ?? null,
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
        })
        em.persist(activity)
      }
    }
  }

  await em.flush()
  return true
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
    console.log('Customer dictionaries seeded for organization', organizationId)
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
    const { resolve } = await createRequestContainer()
    const em = resolve<EntityManager>('em')
    const seeded = await em.transactional(async (tem) =>
      seedCustomerExamples(tem, { tenantId, organizationId })
    )
    if (seeded) {
      console.log('Customer example data seeded for organization', organizationId)
    } else {
      console.log('Customer example data already present; skipping')
    }
  },
}

const customersCliCommands = [seedDictionaries, seedExamples]

export default customersCliCommands
