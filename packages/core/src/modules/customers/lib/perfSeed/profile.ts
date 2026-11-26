export const PERF_TIERS = ['XS', 'S', 'M', 'L'] as const
export type PerfTier = (typeof PERF_TIERS)[number]

export const PERF_PROFILE_IDS = ['perf-v1'] as const
export type PerfProfileId = (typeof PERF_PROFILE_IDS)[number]

export type InteractionBucket = 'light' | 'medium' | 'heavy' | 'extreme'

export type InteractionBucketSpec = {
  bucket: InteractionBucket
  weight: number
  min: number
  max: number
}

export type PipelineSpec = {
  name: string
  weight: number
  stages: Array<{ name: string; probability: number; terminal: 'won' | 'lost' | null }>
}

export type PerfProfile = {
  id: PerfProfileId
  tierEntities: Record<PerfTier, number>
  companyEvery: number
  companyWindow: number
  personWithoutCompanyRate: number
  multiCompanyRate: number
  interactionBuckets: InteractionBucketSpec[]
  interactionSkew: number
  interactionTypes: Array<{ value: string; weight: number }>
  interactionDoneRate: number
  interactionPastDays: number
  interactionFutureDays: number
  interactionOverdueDays: number
  interactionBodyRate: number
  interactionDealLinkRate: number
  entityHistoryDays: number
  dealCountWeights: number[]
  pipelines: PipelineSpec[]
  stageWeights: number[]
  stuckRate: number
  stuckMinDays: number
  stuckMaxDays: number
  freshMaxDays: number
  dealCurrencies: Array<{ code: string; weight: number }>
  commentCountWeights: number[]
  personAddressRate: number
  geocodedRate: number
  tagCount: number
  tagAssignmentWeights: number[]
  tagZipfExponent: number
  customFieldFillRate: number
  heavyOwnerShare: number
  heavyOwnerRecordShare: number
  dictionaryZipfExponent: number
  uniqueSurnameRate: number
  hotSetPeople: number
  hotSetCompanies: number
  catalogCap: number
}

export const PERF_V1: PerfProfile = {
  id: 'perf-v1',
  tierEntities: { XS: 2_000, S: 50_000, M: 100_000, L: 1_000_000 },
  companyEvery: 4,
  companyWindow: 50,
  personWithoutCompanyRate: 0.1,
  multiCompanyRate: 0.05,
  interactionBuckets: [
    { bucket: 'light', weight: 0.6, min: 1, max: 5 },
    { bucket: 'medium', weight: 0.3, min: 6, max: 20 },
    { bucket: 'heavy', weight: 0.09, min: 21, max: 100 },
    { bucket: 'extreme', weight: 0.01, min: 101, max: 1000 },
  ],
  interactionSkew: 2.5,
  interactionTypes: [
    { value: 'call', weight: 0.25 },
    { value: 'email', weight: 0.3 },
    { value: 'meeting', weight: 0.15 },
    { value: 'note', weight: 0.2 },
    { value: 'task', weight: 0.1 },
  ],
  interactionDoneRate: 0.7,
  interactionPastDays: 1095,
  interactionFutureDays: 90,
  interactionOverdueDays: 14,
  interactionBodyRate: 0.5,
  interactionDealLinkRate: 0.1,
  entityHistoryDays: 1460,
  dealCountWeights: [0.6, 0.3, 0.1],
  pipelines: [
    {
      name: 'Perf New Business',
      weight: 0.7,
      stages: [
        { name: 'Qualification', probability: 10, terminal: null },
        { name: 'Discovery', probability: 25, terminal: null },
        { name: 'Proposal', probability: 50, terminal: null },
        { name: 'Negotiation', probability: 75, terminal: null },
        { name: 'Won', probability: 100, terminal: 'won' },
        { name: 'Lost', probability: 0, terminal: 'lost' },
      ],
    },
    {
      name: 'Perf Renewals',
      weight: 0.3,
      stages: [
        { name: 'Renewal Due', probability: 20, terminal: null },
        { name: 'Usage Review', probability: 40, terminal: null },
        { name: 'Quote Sent', probability: 60, terminal: null },
        { name: 'Contracting', probability: 85, terminal: null },
        { name: 'Closed Won', probability: 100, terminal: 'won' },
        { name: 'Closed Lost', probability: 0, terminal: 'lost' },
      ],
    },
  ],
  stageWeights: [0.18, 0.2, 0.2, 0.16, 0.14, 0.12],
  stuckRate: 0.15,
  stuckMinDays: 30,
  stuckMaxDays: 180,
  freshMaxDays: 10,
  dealCurrencies: [
    { code: 'EUR', weight: 0.5 },
    { code: 'USD', weight: 0.3 },
    { code: 'PLN', weight: 0.2 },
  ],
  commentCountWeights: [0.1, 0.25, 0.3, 0.2, 0.15],
  personAddressRate: 0.3,
  geocodedRate: 0.6,
  tagCount: 50,
  tagAssignmentWeights: [0.25, 0.35, 0.25, 0.15],
  tagZipfExponent: 1.1,
  customFieldFillRate: 0.6,
  heavyOwnerShare: 0.1,
  heavyOwnerRecordShare: 0.4,
  dictionaryZipfExponent: 1.2,
  uniqueSurnameRate: 0.02,
  hotSetPeople: 50,
  hotSetCompanies: 20,
  catalogCap: 2000,
}

export const PERF_PROFILES: Record<PerfProfileId, PerfProfile> = {
  'perf-v1': PERF_V1,
}

function combine(heads: readonly string[], tails: readonly string[]): string[] {
  const words: string[] = []
  for (const head of heads) {
    for (const tail of tails) words.push(`${head}${tail}`)
  }
  return words
}

export const FIRST_NAME_HEADS = ['Al', 'Bel', 'Cor', 'Dan', 'El', 'Fen', 'Gil', 'Hal', 'Iv', 'Jor', 'Kal', 'Lin', 'Mar', 'Nor', 'Or', 'Pel', 'Rin', 'Sel', 'Tam', 'Vin']
export const FIRST_NAME_TAILS = ['a', 'en', 'io', 'ar', 'is', 'on', 'ette', 'iel', 'o', 'us']
export const FIRST_NAMES = combine(FIRST_NAME_HEADS, FIRST_NAME_TAILS)

export const LAST_NAME_HEADS = ['Brack', 'Corm', 'Dell', 'Fair', 'Glen', 'Hart', 'Kess', 'Lowe', 'Mont', 'Nash', 'Pryd', 'Rook', 'Stav', 'Thorn', 'Vale', 'Wick', 'Yarr', 'Zell', 'Ashk', 'Birch']
export const LAST_NAME_TAILS = ['man', 'ford', 'wick', 'ton', 'ley', 'field', 'ridge', 'stone', 'wood', 'berg', 'dale', 'more', 'croft', 'by', 'well']
export const LAST_NAMES = combine(LAST_NAME_HEADS, LAST_NAME_TAILS)

export const UNIQUE_SURNAME_PREFIX = 'Uni'
export const UNIQUE_SURNAME_SYLLABLES = [
  'ba', 'be', 'bo', 'da', 'de', 'do', 'ka', 'ke', 'ko', 'la', 'le', 'lo', 'ma', 'me', 'mo', 'ra', 're', 'ro', 'ta', 'te',
] as const
export const UNIQUE_SURNAME_WIDTH = 5

export const NO_HIT_TERMS = [
  'Qxvorbit', 'Qxlumen', 'Qxtarsk', 'Qxpliven', 'Qxzandor', 'Qxmuret', 'Qxolvane', 'Qxhaskit', 'Qxirbel', 'Qxwendo',
]

export const COMPANY_HEADS = [
  'Argent', 'Basalt', 'Cobalt', 'Driftal', 'Ember', 'Ferrox', 'Granit', 'Helix', 'Indig', 'Jaspor', 'Kryon', 'Lumax',
  'Meridia', 'Nimbal', 'Onyxa', 'Prism', 'Quartzo', 'Rivet', 'Solace', 'Tundra', 'Umbral', 'Vertex', 'Wolfram', 'Xenial',
]
export const COMPANY_TAILS = ['Dynamics', 'Systems', 'Logistics', 'Labs', 'Works', 'Holdings', 'Partners', 'Collective']
export const COMPANY_SUFFIXES = ['Ltd', 'Group', 'SA', 'GmbH', 'Inc']

export const JOB_TITLES = [
  'Operations Lead', 'Procurement Manager', 'Revenue Director', 'Platform Engineer', 'Finance Controller',
  'Account Executive', 'Supply Planner', 'Product Owner', 'Customer Success Lead', 'Chief Technologist',
]
export const DEPARTMENTS = ['Operations', 'Finance', 'Engineering', 'Sales', 'Procurement', 'Support', 'Marketing']
export const SENIORITY = ['junior', 'mid', 'senior', 'lead', 'director']
export const TIMEZONES = ['Europe/Warsaw', 'Europe/Berlin', 'Europe/London', 'America/New_York', 'Asia/Singapore']
export const INDUSTRIES = ['Software', 'Manufacturing', 'Logistics', 'Retail', 'Healthcare', 'Energy', 'Media', 'Financial Services']
export const SIZE_BUCKETS = ['1-10', '11-50', '51-200', '201-500', '500+']
export const RENEWAL_QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4']
export const DEAL_ROLES = ['decision maker', 'influencer', 'sponsor', 'evaluation lead']

export const TOPIC_WORDS = [
  'rollout', 'pricing', 'renewal', 'onboarding', 'integration', 'audit', 'roadmap', 'migration', 'forecast',
  'contract', 'pilot', 'workshop', 'escalation', 'invoice', 'shipment', 'warranty', 'training', 'review',
]
export const ACTION_WORDS = ['Discuss', 'Confirm', 'Prepare', 'Follow up on', 'Plan', 'Review', 'Align on', 'Close out']
export const FILLER_WORDS = [
  'team', 'agreed', 'next', 'steps', 'budget', 'timeline', 'scope', 'stakeholders', 'risks', 'requested', 'update',
  'quarter', 'targets', 'volume', 'details', 'approval', 'feedback', 'priority', 'blocked', 'pending', 'shared', 'notes',
]

export const CITY_HEADS = ['Brzo', 'Kalin', 'Lesz', 'Mirow', 'Nadol', 'Ostra', 'Pilaw', 'Rudno', 'Sokol', 'Tarno', 'Wilko', 'Zabor']
export const CITY_TAILS = ['wice', 'owo', 'ice', 'any', 'ek', 'ow']
export const STREET_WORDS = ['Lipowa', 'Polna', 'Lesna', 'Sloneczna', 'Krotka', 'Ogrodowa', 'Szkolna', 'Kwiatowa', 'Brzozowa', 'Lakowa']
export const REGIONS = ['Mazowieckie', 'Malopolskie', 'Slaskie', 'Pomorskie', 'Wielkopolskie', 'Dolnoslaskie']

export const TAG_WORDS = [
  'Alpha', 'Bravo', 'Cedar', 'Delta', 'Echo', 'Falcon', 'Garnet', 'Harbor', 'Iris', 'Juniper',
]
export const TAG_KINDS = ['Segment', 'Region', 'Campaign', 'Tier', 'Program']
export const TAG_COLORS = ['#2563eb', '#16a34a', '#f97316', '#a855f7', '#0ea5e9', '#ef4444', '#64748b']

export const PERF_EMAIL_FALLBACK_DOMAIN = 'perf-mail.example'
