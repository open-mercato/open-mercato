export type Subdivision = {
  countryCode: string
  code: string
  name: string
  type: 'state' | 'district' | 'territory'
}

const US_SUBDIVISIONS: readonly Subdivision[] = [
  { countryCode: 'US', code: 'AL', name: 'Alabama', type: 'state' },
  { countryCode: 'US', code: 'AK', name: 'Alaska', type: 'state' },
  { countryCode: 'US', code: 'AZ', name: 'Arizona', type: 'state' },
  { countryCode: 'US', code: 'AR', name: 'Arkansas', type: 'state' },
  { countryCode: 'US', code: 'CA', name: 'California', type: 'state' },
  { countryCode: 'US', code: 'CO', name: 'Colorado', type: 'state' },
  { countryCode: 'US', code: 'CT', name: 'Connecticut', type: 'state' },
  { countryCode: 'US', code: 'DE', name: 'Delaware', type: 'state' },
  { countryCode: 'US', code: 'FL', name: 'Florida', type: 'state' },
  { countryCode: 'US', code: 'GA', name: 'Georgia', type: 'state' },
  { countryCode: 'US', code: 'HI', name: 'Hawaii', type: 'state' },
  { countryCode: 'US', code: 'ID', name: 'Idaho', type: 'state' },
  { countryCode: 'US', code: 'IL', name: 'Illinois', type: 'state' },
  { countryCode: 'US', code: 'IN', name: 'Indiana', type: 'state' },
  { countryCode: 'US', code: 'IA', name: 'Iowa', type: 'state' },
  { countryCode: 'US', code: 'KS', name: 'Kansas', type: 'state' },
  { countryCode: 'US', code: 'KY', name: 'Kentucky', type: 'state' },
  { countryCode: 'US', code: 'LA', name: 'Louisiana', type: 'state' },
  { countryCode: 'US', code: 'ME', name: 'Maine', type: 'state' },
  { countryCode: 'US', code: 'MD', name: 'Maryland', type: 'state' },
  { countryCode: 'US', code: 'MA', name: 'Massachusetts', type: 'state' },
  { countryCode: 'US', code: 'MI', name: 'Michigan', type: 'state' },
  { countryCode: 'US', code: 'MN', name: 'Minnesota', type: 'state' },
  { countryCode: 'US', code: 'MS', name: 'Mississippi', type: 'state' },
  { countryCode: 'US', code: 'MO', name: 'Missouri', type: 'state' },
  { countryCode: 'US', code: 'MT', name: 'Montana', type: 'state' },
  { countryCode: 'US', code: 'NE', name: 'Nebraska', type: 'state' },
  { countryCode: 'US', code: 'NV', name: 'Nevada', type: 'state' },
  { countryCode: 'US', code: 'NH', name: 'New Hampshire', type: 'state' },
  { countryCode: 'US', code: 'NJ', name: 'New Jersey', type: 'state' },
  { countryCode: 'US', code: 'NM', name: 'New Mexico', type: 'state' },
  { countryCode: 'US', code: 'NY', name: 'New York', type: 'state' },
  { countryCode: 'US', code: 'NC', name: 'North Carolina', type: 'state' },
  { countryCode: 'US', code: 'ND', name: 'North Dakota', type: 'state' },
  { countryCode: 'US', code: 'OH', name: 'Ohio', type: 'state' },
  { countryCode: 'US', code: 'OK', name: 'Oklahoma', type: 'state' },
  { countryCode: 'US', code: 'OR', name: 'Oregon', type: 'state' },
  { countryCode: 'US', code: 'PA', name: 'Pennsylvania', type: 'state' },
  { countryCode: 'US', code: 'RI', name: 'Rhode Island', type: 'state' },
  { countryCode: 'US', code: 'SC', name: 'South Carolina', type: 'state' },
  { countryCode: 'US', code: 'SD', name: 'South Dakota', type: 'state' },
  { countryCode: 'US', code: 'TN', name: 'Tennessee', type: 'state' },
  { countryCode: 'US', code: 'TX', name: 'Texas', type: 'state' },
  { countryCode: 'US', code: 'UT', name: 'Utah', type: 'state' },
  { countryCode: 'US', code: 'VT', name: 'Vermont', type: 'state' },
  { countryCode: 'US', code: 'VA', name: 'Virginia', type: 'state' },
  { countryCode: 'US', code: 'WA', name: 'Washington', type: 'state' },
  { countryCode: 'US', code: 'WV', name: 'West Virginia', type: 'state' },
  { countryCode: 'US', code: 'WI', name: 'Wisconsin', type: 'state' },
  { countryCode: 'US', code: 'WY', name: 'Wyoming', type: 'state' },
  { countryCode: 'US', code: 'DC', name: 'District of Columbia', type: 'district' },
  { countryCode: 'US', code: 'AS', name: 'American Samoa', type: 'territory' },
  { countryCode: 'US', code: 'GU', name: 'Guam', type: 'territory' },
  { countryCode: 'US', code: 'MP', name: 'Northern Mariana Islands', type: 'territory' },
  { countryCode: 'US', code: 'PR', name: 'Puerto Rico', type: 'territory' },
  { countryCode: 'US', code: 'VI', name: 'U.S. Virgin Islands', type: 'territory' },
]

export const ISO_SUBDIVISIONS: readonly Subdivision[] = Object.freeze([...US_SUBDIVISIONS])

const BY_COUNTRY = new Map<string, readonly Subdivision[]>()
for (const subdivision of ISO_SUBDIVISIONS) {
  const existing = BY_COUNTRY.get(subdivision.countryCode)
  if (existing) BY_COUNTRY.set(subdivision.countryCode, [...existing, subdivision])
  else BY_COUNTRY.set(subdivision.countryCode, [subdivision])
}

const EMPTY: readonly Subdivision[] = Object.freeze([])

function normalizeCountryCode(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

export function getSubdivisions(countryCode: string | null | undefined): readonly Subdivision[] {
  const normalized = normalizeCountryCode(countryCode)
  if (!normalized) return EMPTY
  return BY_COUNTRY.get(normalized) ?? EMPTY
}

export function isValidSubdivision(countryCode: string | null | undefined, code: string | null | undefined): boolean {
  const normalizedCode = typeof code === 'string' ? code.trim().toUpperCase() : ''
  if (!normalizedCode) return false
  return getSubdivisions(countryCode).some((subdivision) => subdivision.code === normalizedCode)
}

export function hasSubdivisions(countryCode: string | null | undefined): boolean {
  return getSubdivisions(countryCode).length > 0
}
