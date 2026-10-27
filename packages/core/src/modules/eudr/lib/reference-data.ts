import type { EudrCommodity } from '../data/validators'

/**
 * EUDR reference data.
 *
 * Source: Commission Implementing Regulation (EU) 2025/1093 country
 * benchmarking (22 May 2025; in force — the July 2025 EP objection was
 * non-binding — subject to the Commission's 2026 review), the Commission
 * Green Forum country-classification list (cross-checked against independent
 * reproductions; 141 low-risk + 4 high-risk entries), EUDR application dates,
 * and Annex-I/Appendix-I HS data. Effective as of 2026-07. Keep this file as
 * the single update point when the legal reference data changes. Unlisted
 * countries (~48 standard-risk, e.g. BR, ID, MY, and IL per corroborated
 * sources) default to `standard` so full due diligence remains the
 * conservative fallback. Note: CD (DR Congo) is standard; CG (Congo) is low.
 */

export type EudrCountryRiskTier = 'low' | 'standard' | 'high' | 'unknown'

export const EUDR_HIGH_RISK_COUNTRIES = ['BY', 'KP', 'MM', 'RU'] as const

export const EUDR_LOW_RISK_COUNTRIES = [
  'AD', 'AE', 'AF', 'AG', 'AL', 'AM', 'AT', 'AU', 'AZ', 'BA', 'BB', 'BD',
  'BE', 'BG', 'BH', 'BI', 'BN', 'BS', 'BT', 'CA', 'CF', 'CG', 'CH', 'CL',
  'CN', 'CR', 'CU', 'CV', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ',
  'EE', 'EG', 'ES', 'FI', 'FJ', 'FM', 'FR', 'GA', 'GB', 'GD', 'GE', 'GH',
  'GR', 'GY', 'HR', 'HU', 'IE', 'IN', 'IQ', 'IR', 'IS', 'IT', 'JM', 'JO',
  'JP', 'KE', 'KG', 'KI', 'KM', 'KN', 'KR', 'KW', 'KZ', 'LA', 'LB', 'LC',
  'LI', 'LK', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MG',
  'MH', 'MK', 'ML', 'MN', 'MT', 'MU', 'MV', 'NL', 'NO', 'NP', 'NR', 'NZ',
  'OM', 'PG', 'PH', 'PL', 'PS', 'PT', 'PW', 'QA', 'RO', 'RS', 'RW', 'SA',
  'SB', 'SC', 'SE', 'SG', 'SI', 'SK', 'SM', 'SR', 'SS', 'ST', 'SY', 'SZ',
  'TG', 'TH', 'TJ', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'UA', 'UG',
  'US', 'UY', 'UZ', 'VC', 'VN', 'VU', 'WS', 'YE', 'ZA',
] as const

export function getCountryRiskTier(code: string | null | undefined): EudrCountryRiskTier {
  const normalized = code?.trim().toUpperCase() ?? ''
  if (!/^[A-Z]{2}$/.test(normalized)) return 'unknown'
  if ((EUDR_HIGH_RISK_COUNTRIES as readonly string[]).includes(normalized)) return 'high'
  if ((EUDR_LOW_RISK_COUNTRIES as readonly string[]).includes(normalized)) return 'low'
  return 'standard'
}

export const EUDR_APPLICATION_DATES = {
  largeAndMedium: '2026-12-30',
  microAndSmallNonTimber: '2027-06-30',
} as const

export const EUDR_SUPPLEMENTARY_UNIT_HS_PREFIXES = [
  '4011',
  '4013',
  '4104',
  '4403',
  '4406',
  '4408',
  '4410',
  '4411',
  '4412',
  '4413',
  '4701',
  '4702',
  '4704',
  '4705',
] as const

export const EUDR_ANNEX1_HS_PREFIXES: Record<EudrCommodity, readonly string[]> = {
  cattle: ['0102', '0201', '0202', '0206', '1602'],
  cocoa: ['1801', '1802', '1803', '1804', '1805', '1806'],
  coffee: ['0901', '2101'],
  oil_palm: ['1511', '1513', '2306', '1207', '3823', '2905'],
  rubber: ['4001', '4005', '4006', '4007', '4008', '4009', '4010', '4011', '4012', '4013', '4015', '4016', '4017'],
  soya: ['1201', '1208', '1507', '2304'],
  wood: [
    '4401',
    '4402',
    '4403',
    '4404',
    '4405',
    '4406',
    '4407',
    '4408',
    '4409',
    '4410',
    '4411',
    '4412',
    '4413',
    '4414',
    '4415',
    '4416',
    '4417',
    '4418',
    '4419',
    '4420',
    '4421',
    '9401',
    '9403',
    '9406',
    '44',
    '47',
    '48',
  ],
} as const

export function suggestCommodityForHsCode(hsCode: string | null | undefined): EudrCommodity | null {
  const digits = hsCode?.replace(/\D/g, '') ?? ''
  if (digits.length === 0) return null

  let match: { commodity: EudrCommodity; prefixLength: number } | null = null
  for (const [commodity, prefixes] of Object.entries(EUDR_ANNEX1_HS_PREFIXES) as Array<[EudrCommodity, readonly string[]]>) {
    for (const prefix of prefixes) {
      if (!digits.startsWith(prefix)) continue
      if (match !== null && prefix.length <= match.prefixLength) continue
      match = { commodity, prefixLength: prefix.length }
    }
  }

  return match?.commodity ?? null
}

export const EUDR_RISK_CRITERIA_GROUPS = [
  { key: 'country', criteria: ['deforestation_trend', 'environmental_governance', 'corruption_land_use'] },
  { key: 'supply_chain', criteria: ['chain_complexity', 'intermediaries_count', 'mixing_risk', 'prior_noncompliance'] },
  { key: 'plot_supplier', criteria: ['land_title_permits', 'indigenous_rights', 'protected_areas', 'labor_human_rights', 'plot_deforestation_history'] },
  { key: 'documentation', criteria: ['document_completeness', 'document_verifiability', 'supplier_transparency'] },
] as const

export const EUDR_RISK_CRITERIA_KEYS: readonly string[] = EUDR_RISK_CRITERIA_GROUPS.flatMap((group) => [...group.criteria])
