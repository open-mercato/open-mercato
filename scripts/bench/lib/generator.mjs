// Deterministic company generator shared by the dataset builder and the request-cost benchmark.
// Every record is a pure function of (plan seed, tenant key, org key, index), so a dataset can be
// rebuilt or resumed identically, and the benchmark can derive search terms and email prefixes
// that exist in the database even though those columns are stored encrypted.

export function fnv1a(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const ADJECTIVES = ['Blue', 'Northern', 'Silver', 'Bright', 'Golden', 'Rapid', 'Quiet', 'Vivid', 'Solid', 'Prime',
  'Green', 'Urban', 'Coastal', 'Summit', 'Iron', 'Crimson', 'Clear', 'Bold', 'Smart', 'True',
  'Polar', 'Amber', 'Swift', 'Noble', 'Royal', 'Modern', 'Open', 'Lucky', 'Wild', 'Calm',
  'Atlas', 'Nova', 'Delta', 'Alpine', 'Baltic', 'Vistula', 'Oak', 'Granite', 'Copper', 'Cedar']
export const NOUNS = ['River', 'Harbor', 'Peak', 'Forge', 'Field', 'Bridge', 'Stone', 'Wave', 'Grove', 'Valley',
  'Lantern', 'Anchor', 'Compass', 'Falcon', 'Orchard', 'Meadow', 'Signal', 'Circuit', 'Pixel', 'Vector',
  'Harvest', 'Beacon', 'Canyon', 'Ridge', 'Market', 'Garden', 'Engine', 'Tower', 'Haven', 'Path',
  'Spark', 'Cloud', 'Quarry', 'Mill', 'Port', 'Crest', 'Loom', 'Kiln', 'Wharf', 'Fjord']
export const SUFFIXES = ['Labs', 'Systems', 'Group', 'Logistics', 'Foods', 'Partners', 'Holdings', 'Studio',
  'Works', 'Analytics', 'Solutions', 'Energy', 'Health', 'Capital', 'Robotics', 'Media']
const INDUSTRIES = ['E-commerce', 'Energy', 'Financial Services', 'Healthcare', 'Hospitality', 'Logistics',
  'Manufacturing', 'Media', 'Renewable Energy', 'Retail', 'SaaS', 'Software']
const SIZE_BUCKETS = ['1-10', '11-50', '51-200', '201-1000', '1000+']
const EMAIL_PREFIXES = ['hello', 'info', 'contact', 'sales', 'office']
const DESCRIPTIONS = [
  'Regional distributor focused on long-term supply agreements.',
  'Fast-growing team expanding into new European markets.',
  'Long-standing account with a dedicated procurement process.',
  'Evaluating a platform migration within the next two quarters.',
  'Family-owned business with multiple retail locations.',
  'Enterprise customer with strict security review requirements.',
  'Partner-led deal sourced through the reseller channel.',
  'Seasonal demand, peak volumes in the fourth quarter.',
]
const HEALTH = ['healthy', 'monitor', 'at_risk']
const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4']
const NOTES = ['Exec sponsor changed recently.', 'Strong champion in operations.', 'Budget review pending.', 'Expansion opportunity in Q3.']

export function weighted(rand, weights) {
  const entries = Object.entries(weights)
  const total = entries.reduce((acc, [, w]) => acc + w, 0)
  let roll = rand() * total
  for (const [value, w] of entries) {
    roll -= w
    if (roll < 0) return value
  }
  return entries[entries.length - 1][0]
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/**
 * The POST /api/customers/companies body (without tenantId/organizationId) for one record.
 * The `cf_*` keys match the customer custom fields that `mercato init` / `entities install` define.
 */
export function generateCompany(plan, tenantKey, orgKey, index) {
  const rand = mulberry32(fnv1a(`${plan.seed}:${tenantKey}:${orgKey}:${index}`))
  const pick = (list) => list[Math.floor(rand() * list.length)]
  const isNull = (field) => rand() < (plan.distribution.nullRates[field] ?? 0)
  const adjective = pick(ADJECTIVES)
  const noun = pick(NOUNS)
  const suffix = pick(SUFFIXES)
  const displayName = `${adjective} ${noun} ${suffix}`
  const domain = `${slug(`${adjective}-${noun}`)}-${tenantKey}${orgKey}${index.toString(36)}.example.com`
  const phone = `+48 6${Math.floor(rand() * 10)}${Math.floor(rand() * 10)} ${String(Math.floor(rand() * 1000)).padStart(3, '0')} ${String(Math.floor(rand() * 1000)).padStart(3, '0')}`
  const record = {
    displayName,
    primaryEmail: isNull('primaryEmail') ? undefined : `${pick(EMAIL_PREFIXES)}@${domain}`,
    primaryPhone: isNull('primaryPhone') ? undefined : phone,
    description: isNull('description') ? undefined : pick(DESCRIPTIONS),
    status: weighted(rand, plan.distribution.status),
    lifecycleStage: weighted(rand, plan.distribution.lifecycleStage),
    source: weighted(rand, plan.distribution.source),
    legalName: isNull('legalName') ? undefined : `${displayName} Sp. z o.o.`,
    brandName: `${adjective} ${noun}`,
    domain,
    websiteUrl: `https://www.${domain}`,
    industry: pick(INDUSTRIES),
    sizeBucket: pick(SIZE_BUCKETS),
    annualRevenue: isNull('annualRevenue') ? undefined : Math.round(rand() * 50_000) * 1000,
    cf_relationship_health: pick(HEALTH),
    cf_renewal_quarter: pick(QUARTERS),
    cf_executive_notes: isNull('cf_executive_notes') ? undefined : pick(NOTES),
    cf_customer_marketing_case: rand() < 0.3,
  }
  return Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined))
}
