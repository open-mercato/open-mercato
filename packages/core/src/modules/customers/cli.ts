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
} from './data/entities'
import { ensureDictionaryEntry } from './commands/shared'

type SeedArgs = {
  tenantId: string
  organizationId: string
}

const DEAL_STATUS_DEFAULTS = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'win', label: 'Win' },
  { value: 'loose', label: 'Loose' },
  { value: 'in_progress', label: 'In progress' },
]

const PIPELINE_STAGE_DEFAULTS = [
  { value: 'opportunity', label: 'Opportunity' },
  { value: 'marketing_qualified_lead', label: 'Marketing Qualified Lead' },
  { value: 'sales_qualified_lead', label: 'Sales Qualified Lead' },
  { value: 'offering', label: 'Offering' },
  { value: 'negotiations', label: 'Negotiations' },
  { value: 'win', label: 'Win' },
  { value: 'loose', label: 'Loose' },
  { value: 'stalled', label: 'Stalled' },
]

const PRIORITY_CURRENCIES = ['EUR', 'USD', 'GBP', 'PLN']

const EXAMPLE_SOURCE = 'seed:customers.examples'

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
  lifecycleStage?: string
  status?: string
  annualRevenue?: number
  address?: ExampleAddress
  people?: ExamplePerson[]
  deals?: ExampleDeal[]
  interactions?: ExampleActivity[]
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
            color: '#1f77b4',
          },
          {
            entity: 'person',
            personSlug: 'mia-johnson',
            type: 'note',
            subject: 'Shared case studies',
            body: 'Sent two case studies highlighting 18% average utility bill savings for similar complexes.',
            occurredAt: '2024-07-22T19:15:00.000Z',
            icon: 'file-text',
            color: '#9467bd',
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
            color: '#ff7f0e',
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
        color: '#2ca02c',
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
            icon: 'check',
            color: '#17becf',
          },
          {
            entity: 'person',
            personSlug: 'lena-ortiz',
            type: 'email',
            subject: 'Shared onboarding checklist',
            body: 'Sent checklist covering data exports and point-of-sale integrations required for go-live.',
            occurredAt: '2024-06-12T13:05:00.000Z',
            icon: 'clipboard',
            color: '#bcbd22',
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
            icon: 'bar-chart',
            color: '#e377c2',
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
        icon: 'dollar-sign',
        color: '#8c564b',
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
            icon: 'edit-3',
            color: '#ff9896',
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
            icon: 'x-circle',
            color: '#d62728',
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
        icon: 'star',
        color: '#f1c40f',
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
  for (const entry of DEAL_STATUS_DEFAULTS) {
    await ensureDictionaryEntry(em, {
      tenantId,
      organizationId,
      kind: 'deal_status',
      value: entry.value,
      label: entry.label,
    })
  }
  for (const entry of PIPELINE_STAGE_DEFAULTS) {
    await ensureDictionaryEntry(em, {
      tenantId,
      organizationId,
      kind: 'pipeline_stage',
      value: entry.value,
      label: entry.label,
    })
  }
}

function resolveCurrencyCodes(): string[] {
  const normalizedPriority = PRIORITY_CURRENCIES.map((code) => code.toUpperCase())
  const prioritySet = new Set(normalizedPriority)
  const supported: string[] =
    typeof (Intl as any)?.supportedValuesOf === 'function'
      ? ((Intl as any).supportedValuesOf('currency') as string[])
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
    if (typeof (Intl as any).DisplayNames === 'function') {
      const displayNames = new (Intl as any).DisplayNames(['en'], { type: 'currency' })
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
  const already = await em.count(CustomerDeal, {
    tenantId,
    organizationId,
    source: EXAMPLE_SOURCE,
  })
  if (already > 0) {
    return false
  }

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
      source: EXAMPLE_SOURCE,
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
        source: EXAMPLE_SOURCE,
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
        source: EXAMPLE_SOURCE,
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

export default [seedDictionaries, seedExamples]
