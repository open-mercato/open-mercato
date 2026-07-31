"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { extractPhoneDigits, validatePhoneNumber } from '@open-mercato/shared/lib/phone'
import { cn } from '@open-mercato/shared/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemLeading,
  SelectTrigger,
} from '../../primitives/select'

export type PhoneDuplicateMatch = {
  id: string
  label: string
  href: string
}

export type PhoneCountry = {
  /** ISO 3166-1 alpha-2 code. */
  iso2: string
  /** International dial code (with `+`). */
  dialCode: string
  /** Human-readable country name (English). Override per surface for i18n. */
  label: string
  /** Emoji flag (no asset dependency). */
  flag: string
}

/**
 * Emoji flag for an ISO 3166-1 alpha-2 code, assembled from the two regional
 * indicator symbols. Deriving it keeps the (large) dictionary free of hand-typed
 * emoji and guarantees the flag always matches the code.
 */
function iso2ToFlagEmoji(iso2: string): string {
  const letters = iso2.toUpperCase().replace(/[^A-Z]/g, '')
  if (letters.length !== 2) return ''
  const base = 0x1f1e6
  return String.fromCodePoint(
    base + letters.charCodeAt(0) - 65,
    base + letters.charCodeAt(1) - 65,
  )
}

/**
 * Complete static dictionary of geographic countries and territories that have
 * an ISO 3166-1 alpha-2 code and an international calling code, based on the
 * ITU / Wikipedia list of telephone country codes.
 *
 * Rules baked into this data:
 * - Labels are English; flags are derived from the ISO code (`iso2ToFlagEmoji`).
 * - Non-geographic / international service codes (`+800`, `+808`, `+870`,
 *   `+881`, `+882`, …) are intentionally excluded.
 * - North American Numbering Plan territories carry their full `+1<NPA>` dial
 *   code (e.g. Bahamas `+1242`) so longest-prefix matching resolves them before
 *   the generic `+1`. The US and Canada BOTH use a bare `+1` and cannot be told
 *   apart from the prefix alone — auto-detection favours the US.
 * - Several sovereign countries share a calling code with dependent territories
 *   (e.g. `+44` UK/Guernsey/Jersey/Isle of Man); `PRIMARY_DIAL_OWNERS` records
 *   the country that wins auto-detection for those shared codes.
 */
const RAW_PHONE_COUNTRIES: Array<Omit<PhoneCountry, 'flag'>> = [
  { iso2: 'US', dialCode: '+1', label: 'United States' },
  { iso2: 'CA', dialCode: '+1', label: 'Canada' },
  { iso2: 'AG', dialCode: '+1268', label: 'Antigua and Barbuda' },
  { iso2: 'AI', dialCode: '+1264', label: 'Anguilla' },
  { iso2: 'AS', dialCode: '+1684', label: 'American Samoa' },
  { iso2: 'BB', dialCode: '+1246', label: 'Barbados' },
  { iso2: 'BM', dialCode: '+1441', label: 'Bermuda' },
  { iso2: 'BS', dialCode: '+1242', label: 'Bahamas' },
  { iso2: 'DM', dialCode: '+1767', label: 'Dominica' },
  { iso2: 'DO', dialCode: '+1809', label: 'Dominican Republic' },
  { iso2: 'GD', dialCode: '+1473', label: 'Grenada' },
  { iso2: 'GU', dialCode: '+1671', label: 'Guam' },
  { iso2: 'JM', dialCode: '+1876', label: 'Jamaica' },
  { iso2: 'KN', dialCode: '+1869', label: 'Saint Kitts and Nevis' },
  { iso2: 'KY', dialCode: '+1345', label: 'Cayman Islands' },
  { iso2: 'LC', dialCode: '+1758', label: 'Saint Lucia' },
  { iso2: 'MP', dialCode: '+1670', label: 'Northern Mariana Islands' },
  { iso2: 'MS', dialCode: '+1664', label: 'Montserrat' },
  { iso2: 'PR', dialCode: '+1787', label: 'Puerto Rico' },
  { iso2: 'SX', dialCode: '+1721', label: 'Sint Maarten' },
  { iso2: 'TC', dialCode: '+1649', label: 'Turks and Caicos Islands' },
  { iso2: 'TT', dialCode: '+1868', label: 'Trinidad and Tobago' },
  { iso2: 'VC', dialCode: '+1784', label: 'Saint Vincent and the Grenadines' },
  { iso2: 'VG', dialCode: '+1284', label: 'British Virgin Islands' },
  { iso2: 'VI', dialCode: '+1340', label: 'U.S. Virgin Islands' },
  { iso2: 'EG', dialCode: '+20', label: 'Egypt' },
  { iso2: 'SS', dialCode: '+211', label: 'South Sudan' },
  { iso2: 'MA', dialCode: '+212', label: 'Morocco' },
  { iso2: 'EH', dialCode: '+212', label: 'Western Sahara' },
  { iso2: 'DZ', dialCode: '+213', label: 'Algeria' },
  { iso2: 'TN', dialCode: '+216', label: 'Tunisia' },
  { iso2: 'LY', dialCode: '+218', label: 'Libya' },
  { iso2: 'GM', dialCode: '+220', label: 'Gambia' },
  { iso2: 'SN', dialCode: '+221', label: 'Senegal' },
  { iso2: 'MR', dialCode: '+222', label: 'Mauritania' },
  { iso2: 'ML', dialCode: '+223', label: 'Mali' },
  { iso2: 'GN', dialCode: '+224', label: 'Guinea' },
  { iso2: 'CI', dialCode: '+225', label: "Côte d'Ivoire" },
  { iso2: 'BF', dialCode: '+226', label: 'Burkina Faso' },
  { iso2: 'NE', dialCode: '+227', label: 'Niger' },
  { iso2: 'TG', dialCode: '+228', label: 'Togo' },
  { iso2: 'BJ', dialCode: '+229', label: 'Benin' },
  { iso2: 'MU', dialCode: '+230', label: 'Mauritius' },
  { iso2: 'LR', dialCode: '+231', label: 'Liberia' },
  { iso2: 'SL', dialCode: '+232', label: 'Sierra Leone' },
  { iso2: 'GH', dialCode: '+233', label: 'Ghana' },
  { iso2: 'NG', dialCode: '+234', label: 'Nigeria' },
  { iso2: 'TD', dialCode: '+235', label: 'Chad' },
  { iso2: 'CF', dialCode: '+236', label: 'Central African Republic' },
  { iso2: 'CM', dialCode: '+237', label: 'Cameroon' },
  { iso2: 'CV', dialCode: '+238', label: 'Cape Verde' },
  { iso2: 'ST', dialCode: '+239', label: 'São Tomé and Príncipe' },
  { iso2: 'GQ', dialCode: '+240', label: 'Equatorial Guinea' },
  { iso2: 'GA', dialCode: '+241', label: 'Gabon' },
  { iso2: 'CG', dialCode: '+242', label: 'Republic of the Congo' },
  { iso2: 'CD', dialCode: '+243', label: 'DR Congo' },
  { iso2: 'AO', dialCode: '+244', label: 'Angola' },
  { iso2: 'GW', dialCode: '+245', label: 'Guinea-Bissau' },
  { iso2: 'IO', dialCode: '+246', label: 'British Indian Ocean Territory' },
  { iso2: 'SC', dialCode: '+248', label: 'Seychelles' },
  { iso2: 'SD', dialCode: '+249', label: 'Sudan' },
  { iso2: 'RW', dialCode: '+250', label: 'Rwanda' },
  { iso2: 'ET', dialCode: '+251', label: 'Ethiopia' },
  { iso2: 'SO', dialCode: '+252', label: 'Somalia' },
  { iso2: 'DJ', dialCode: '+253', label: 'Djibouti' },
  { iso2: 'KE', dialCode: '+254', label: 'Kenya' },
  { iso2: 'TZ', dialCode: '+255', label: 'Tanzania' },
  { iso2: 'UG', dialCode: '+256', label: 'Uganda' },
  { iso2: 'BI', dialCode: '+257', label: 'Burundi' },
  { iso2: 'MZ', dialCode: '+258', label: 'Mozambique' },
  { iso2: 'ZM', dialCode: '+260', label: 'Zambia' },
  { iso2: 'MG', dialCode: '+261', label: 'Madagascar' },
  { iso2: 'RE', dialCode: '+262', label: 'Réunion' },
  { iso2: 'YT', dialCode: '+262', label: 'Mayotte' },
  { iso2: 'ZW', dialCode: '+263', label: 'Zimbabwe' },
  { iso2: 'NA', dialCode: '+264', label: 'Namibia' },
  { iso2: 'MW', dialCode: '+265', label: 'Malawi' },
  { iso2: 'LS', dialCode: '+266', label: 'Lesotho' },
  { iso2: 'BW', dialCode: '+267', label: 'Botswana' },
  { iso2: 'SZ', dialCode: '+268', label: 'Eswatini' },
  { iso2: 'KM', dialCode: '+269', label: 'Comoros' },
  { iso2: 'ZA', dialCode: '+27', label: 'South Africa' },
  { iso2: 'SH', dialCode: '+290', label: 'Saint Helena' },
  { iso2: 'ER', dialCode: '+291', label: 'Eritrea' },
  { iso2: 'AW', dialCode: '+297', label: 'Aruba' },
  { iso2: 'FO', dialCode: '+298', label: 'Faroe Islands' },
  { iso2: 'GL', dialCode: '+299', label: 'Greenland' },
  { iso2: 'GR', dialCode: '+30', label: 'Greece' },
  { iso2: 'NL', dialCode: '+31', label: 'Netherlands' },
  { iso2: 'BE', dialCode: '+32', label: 'Belgium' },
  { iso2: 'FR', dialCode: '+33', label: 'France' },
  { iso2: 'ES', dialCode: '+34', label: 'Spain' },
  { iso2: 'GI', dialCode: '+350', label: 'Gibraltar' },
  { iso2: 'PT', dialCode: '+351', label: 'Portugal' },
  { iso2: 'LU', dialCode: '+352', label: 'Luxembourg' },
  { iso2: 'IE', dialCode: '+353', label: 'Ireland' },
  { iso2: 'IS', dialCode: '+354', label: 'Iceland' },
  { iso2: 'AL', dialCode: '+355', label: 'Albania' },
  { iso2: 'MT', dialCode: '+356', label: 'Malta' },
  { iso2: 'CY', dialCode: '+357', label: 'Cyprus' },
  { iso2: 'FI', dialCode: '+358', label: 'Finland' },
  { iso2: 'AX', dialCode: '+358', label: 'Åland Islands' },
  { iso2: 'BG', dialCode: '+359', label: 'Bulgaria' },
  { iso2: 'HU', dialCode: '+36', label: 'Hungary' },
  { iso2: 'LT', dialCode: '+370', label: 'Lithuania' },
  { iso2: 'LV', dialCode: '+371', label: 'Latvia' },
  { iso2: 'EE', dialCode: '+372', label: 'Estonia' },
  { iso2: 'MD', dialCode: '+373', label: 'Moldova' },
  { iso2: 'AM', dialCode: '+374', label: 'Armenia' },
  { iso2: 'BY', dialCode: '+375', label: 'Belarus' },
  { iso2: 'AD', dialCode: '+376', label: 'Andorra' },
  { iso2: 'MC', dialCode: '+377', label: 'Monaco' },
  { iso2: 'SM', dialCode: '+378', label: 'San Marino' },
  { iso2: 'VA', dialCode: '+379', label: 'Vatican City' },
  { iso2: 'UA', dialCode: '+380', label: 'Ukraine' },
  { iso2: 'RS', dialCode: '+381', label: 'Serbia' },
  { iso2: 'ME', dialCode: '+382', label: 'Montenegro' },
  { iso2: 'XK', dialCode: '+383', label: 'Kosovo' },
  { iso2: 'HR', dialCode: '+385', label: 'Croatia' },
  { iso2: 'SI', dialCode: '+386', label: 'Slovenia' },
  { iso2: 'BA', dialCode: '+387', label: 'Bosnia and Herzegovina' },
  { iso2: 'MK', dialCode: '+389', label: 'North Macedonia' },
  { iso2: 'IT', dialCode: '+39', label: 'Italy' },
  { iso2: 'RO', dialCode: '+40', label: 'Romania' },
  { iso2: 'CH', dialCode: '+41', label: 'Switzerland' },
  { iso2: 'CZ', dialCode: '+420', label: 'Czechia' },
  { iso2: 'SK', dialCode: '+421', label: 'Slovakia' },
  { iso2: 'LI', dialCode: '+423', label: 'Liechtenstein' },
  { iso2: 'AT', dialCode: '+43', label: 'Austria' },
  { iso2: 'GB', dialCode: '+44', label: 'United Kingdom' },
  { iso2: 'GG', dialCode: '+44', label: 'Guernsey' },
  { iso2: 'JE', dialCode: '+44', label: 'Jersey' },
  { iso2: 'IM', dialCode: '+44', label: 'Isle of Man' },
  { iso2: 'DK', dialCode: '+45', label: 'Denmark' },
  { iso2: 'SE', dialCode: '+46', label: 'Sweden' },
  { iso2: 'NO', dialCode: '+47', label: 'Norway' },
  { iso2: 'SJ', dialCode: '+47', label: 'Svalbard and Jan Mayen' },
  { iso2: 'PL', dialCode: '+48', label: 'Poland' },
  { iso2: 'DE', dialCode: '+49', label: 'Germany' },
  { iso2: 'FK', dialCode: '+500', label: 'Falkland Islands' },
  { iso2: 'BZ', dialCode: '+501', label: 'Belize' },
  { iso2: 'GT', dialCode: '+502', label: 'Guatemala' },
  { iso2: 'SV', dialCode: '+503', label: 'El Salvador' },
  { iso2: 'HN', dialCode: '+504', label: 'Honduras' },
  { iso2: 'NI', dialCode: '+505', label: 'Nicaragua' },
  { iso2: 'CR', dialCode: '+506', label: 'Costa Rica' },
  { iso2: 'PA', dialCode: '+507', label: 'Panama' },
  { iso2: 'PM', dialCode: '+508', label: 'Saint Pierre and Miquelon' },
  { iso2: 'HT', dialCode: '+509', label: 'Haiti' },
  { iso2: 'PE', dialCode: '+51', label: 'Peru' },
  { iso2: 'MX', dialCode: '+52', label: 'Mexico' },
  { iso2: 'CU', dialCode: '+53', label: 'Cuba' },
  { iso2: 'AR', dialCode: '+54', label: 'Argentina' },
  { iso2: 'BR', dialCode: '+55', label: 'Brazil' },
  { iso2: 'CL', dialCode: '+56', label: 'Chile' },
  { iso2: 'CO', dialCode: '+57', label: 'Colombia' },
  { iso2: 'VE', dialCode: '+58', label: 'Venezuela' },
  { iso2: 'GP', dialCode: '+590', label: 'Guadeloupe' },
  { iso2: 'BL', dialCode: '+590', label: 'Saint Barthélemy' },
  { iso2: 'MF', dialCode: '+590', label: 'Saint Martin' },
  { iso2: 'BO', dialCode: '+591', label: 'Bolivia' },
  { iso2: 'GY', dialCode: '+592', label: 'Guyana' },
  { iso2: 'EC', dialCode: '+593', label: 'Ecuador' },
  { iso2: 'GF', dialCode: '+594', label: 'French Guiana' },
  { iso2: 'PY', dialCode: '+595', label: 'Paraguay' },
  { iso2: 'MQ', dialCode: '+596', label: 'Martinique' },
  { iso2: 'SR', dialCode: '+597', label: 'Suriname' },
  { iso2: 'UY', dialCode: '+598', label: 'Uruguay' },
  { iso2: 'CW', dialCode: '+599', label: 'Curaçao' },
  { iso2: 'BQ', dialCode: '+599', label: 'Caribbean Netherlands' },
  { iso2: 'MY', dialCode: '+60', label: 'Malaysia' },
  { iso2: 'AU', dialCode: '+61', label: 'Australia' },
  { iso2: 'CX', dialCode: '+61', label: 'Christmas Island' },
  { iso2: 'CC', dialCode: '+61', label: 'Cocos (Keeling) Islands' },
  { iso2: 'ID', dialCode: '+62', label: 'Indonesia' },
  { iso2: 'PH', dialCode: '+63', label: 'Philippines' },
  { iso2: 'NZ', dialCode: '+64', label: 'New Zealand' },
  { iso2: 'SG', dialCode: '+65', label: 'Singapore' },
  { iso2: 'TH', dialCode: '+66', label: 'Thailand' },
  { iso2: 'TL', dialCode: '+670', label: 'Timor-Leste' },
  { iso2: 'NF', dialCode: '+672', label: 'Norfolk Island' },
  { iso2: 'BN', dialCode: '+673', label: 'Brunei' },
  { iso2: 'NR', dialCode: '+674', label: 'Nauru' },
  { iso2: 'PG', dialCode: '+675', label: 'Papua New Guinea' },
  { iso2: 'TO', dialCode: '+676', label: 'Tonga' },
  { iso2: 'SB', dialCode: '+677', label: 'Solomon Islands' },
  { iso2: 'VU', dialCode: '+678', label: 'Vanuatu' },
  { iso2: 'FJ', dialCode: '+679', label: 'Fiji' },
  { iso2: 'PW', dialCode: '+680', label: 'Palau' },
  { iso2: 'WF', dialCode: '+681', label: 'Wallis and Futuna' },
  { iso2: 'CK', dialCode: '+682', label: 'Cook Islands' },
  { iso2: 'NU', dialCode: '+683', label: 'Niue' },
  { iso2: 'WS', dialCode: '+685', label: 'Samoa' },
  { iso2: 'KI', dialCode: '+686', label: 'Kiribati' },
  { iso2: 'NC', dialCode: '+687', label: 'New Caledonia' },
  { iso2: 'TV', dialCode: '+688', label: 'Tuvalu' },
  { iso2: 'PF', dialCode: '+689', label: 'French Polynesia' },
  { iso2: 'TK', dialCode: '+690', label: 'Tokelau' },
  { iso2: 'FM', dialCode: '+691', label: 'Micronesia' },
  { iso2: 'MH', dialCode: '+692', label: 'Marshall Islands' },
  { iso2: 'RU', dialCode: '+7', label: 'Russia' },
  { iso2: 'KZ', dialCode: '+7', label: 'Kazakhstan' },
  { iso2: 'JP', dialCode: '+81', label: 'Japan' },
  { iso2: 'KR', dialCode: '+82', label: 'South Korea' },
  { iso2: 'VN', dialCode: '+84', label: 'Vietnam' },
  { iso2: 'KP', dialCode: '+850', label: 'North Korea' },
  { iso2: 'HK', dialCode: '+852', label: 'Hong Kong' },
  { iso2: 'MO', dialCode: '+853', label: 'Macau' },
  { iso2: 'KH', dialCode: '+855', label: 'Cambodia' },
  { iso2: 'LA', dialCode: '+856', label: 'Laos' },
  { iso2: 'CN', dialCode: '+86', label: 'China' },
  { iso2: 'BD', dialCode: '+880', label: 'Bangladesh' },
  { iso2: 'TW', dialCode: '+886', label: 'Taiwan' },
  { iso2: 'TR', dialCode: '+90', label: 'Turkey' },
  { iso2: 'IN', dialCode: '+91', label: 'India' },
  { iso2: 'PK', dialCode: '+92', label: 'Pakistan' },
  { iso2: 'AF', dialCode: '+93', label: 'Afghanistan' },
  { iso2: 'LK', dialCode: '+94', label: 'Sri Lanka' },
  { iso2: 'MM', dialCode: '+95', label: 'Myanmar' },
  { iso2: 'MV', dialCode: '+960', label: 'Maldives' },
  { iso2: 'LB', dialCode: '+961', label: 'Lebanon' },
  { iso2: 'JO', dialCode: '+962', label: 'Jordan' },
  { iso2: 'SY', dialCode: '+963', label: 'Syria' },
  { iso2: 'IQ', dialCode: '+964', label: 'Iraq' },
  { iso2: 'KW', dialCode: '+965', label: 'Kuwait' },
  { iso2: 'SA', dialCode: '+966', label: 'Saudi Arabia' },
  { iso2: 'YE', dialCode: '+967', label: 'Yemen' },
  { iso2: 'OM', dialCode: '+968', label: 'Oman' },
  { iso2: 'PS', dialCode: '+970', label: 'Palestine' },
  { iso2: 'AE', dialCode: '+971', label: 'United Arab Emirates' },
  { iso2: 'IL', dialCode: '+972', label: 'Israel' },
  { iso2: 'BH', dialCode: '+973', label: 'Bahrain' },
  { iso2: 'QA', dialCode: '+974', label: 'Qatar' },
  { iso2: 'BT', dialCode: '+975', label: 'Bhutan' },
  { iso2: 'MN', dialCode: '+976', label: 'Mongolia' },
  { iso2: 'NP', dialCode: '+977', label: 'Nepal' },
  { iso2: 'TJ', dialCode: '+992', label: 'Tajikistan' },
  { iso2: 'TM', dialCode: '+993', label: 'Turkmenistan' },
  { iso2: 'AZ', dialCode: '+994', label: 'Azerbaijan' },
  { iso2: 'GE', dialCode: '+995', label: 'Georgia' },
  { iso2: 'KG', dialCode: '+996', label: 'Kyrgyzstan' },
  { iso2: 'UZ', dialCode: '+998', label: 'Uzbekistan' },
  { iso2: 'IR', dialCode: '+98', label: 'Iran' },
]

export const PHONE_COUNTRIES: PhoneCountry[] = RAW_PHONE_COUNTRIES
  .map((country) => ({ ...country, flag: iso2ToFlagEmoji(country.iso2) }))
  .sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }))

/**
 * Sovereign/primary country that wins auto-detection for a calling code shared
 * by several territories. US vs. Canada is the one irreducible ambiguity — both
 * are `+1` — and it resolves to the US.
 */
const PRIMARY_DIAL_OWNERS: Record<string, string> = {
  '+1': 'US',
  '+7': 'RU',
  '+44': 'GB',
  '+47': 'NO',
  '+61': 'AU',
  '+212': 'MA',
  '+262': 'RE',
  '+358': 'FI',
  '+590': 'GP',
  '+599': 'CW',
}

const DEFAULT_COUNTRY =
  PHONE_COUNTRIES.find((country) => country.iso2 === 'US') ?? PHONE_COUNTRIES[0]

// Match longer prefixes first (e.g. `+1242` before `+1`); for equal-length codes
// shared by several territories, prefer the sovereign in `PRIMARY_DIAL_OWNERS`.
const COUNTRIES_BY_DIAL_LENGTH = [...PHONE_COUNTRIES].sort((a, b) => {
  if (b.dialCode.length !== a.dialCode.length) return b.dialCode.length - a.dialCode.length
  const aPrimary = PRIMARY_DIAL_OWNERS[a.dialCode] === a.iso2 ? 0 : 1
  const bPrimary = PRIMARY_DIAL_OWNERS[b.dialCode] === b.iso2 ? 0 : 1
  return aPrimary - bPrimary
})

function findCountryByIso(iso2: string): PhoneCountry | undefined {
  return PHONE_COUNTRIES.find((c) => c.iso2 === iso2)
}

function parseCountryFromValue(value: string | null | undefined): PhoneCountry | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed.startsWith('+')) return null
  for (const country of COUNTRIES_BY_DIAL_LENGTH) {
    if (trimmed.startsWith(country.dialCode)) return country
  }
  return null
}

function extractLocalNumber(value: string | null | undefined, dialCode: string): string {
  if (!value) return ''
  const trimmed = value.trim()
  if (!trimmed.startsWith(dialCode)) return trimmed
  return trimmed.slice(dialCode.length).trim()
}

function composeValue(country: PhoneCountry, localNumber: string): string {
  const trimmed = localNumber.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('+')) return trimmed
  return `${country.dialCode} ${trimmed}`
}

export type PhoneNumberFieldProps = {
  id?: string
  value?: string | null
  onValueChange: (next: string | undefined) => void
  onDigitsChange?: (digits: string | null) => void
  externalError?: string | null
  disabled?: boolean
  autoFocus?: boolean
  ariaLabel?: string
  ariaDescribedBy?: string
  placeholder?: string
  minDigits?: number
  checkingLabel?: string
  duplicateLabel?: (match: PhoneDuplicateMatch) => string
  duplicateLinkLabel?: string
  invalidLabel?: string
  onDuplicateLookup?: (normalizedValue: string) => Promise<PhoneDuplicateMatch | null>
  /** Override the static country list (e.g. limit to specific markets). */
  countries?: PhoneCountry[]
  /** Initial country shown when `value` is empty / unparseable. Defaults to US. */
  defaultCountryIso2?: string
}

const DEFAULT_MIN_DIGITS = 6
const DEFAULT_PLACEHOLDER = '(555) 000-0000'

export function PhoneNumberField({
  id,
  value,
  onValueChange,
  onDigitsChange,
  externalError,
  disabled = false,
  autoFocus,
  ariaLabel,
  ariaDescribedBy,
  placeholder,
  minDigits = DEFAULT_MIN_DIGITS,
  checkingLabel,
  duplicateLabel,
  duplicateLinkLabel,
  invalidLabel,
  onDuplicateLookup,
  countries: countriesProp,
  defaultCountryIso2,
}: PhoneNumberFieldProps) {
  const t = useT()
  const resolvedInvalidLabel = invalidLabel ?? t(
    'ui.inputs.phoneNumberField.invalid',
    'Enter a valid phone number with country code (e.g. +1 212 555 1234)'
  )
  const resolvedCheckingLabel = checkingLabel ?? t(
    'ui.inputs.phoneNumberField.checking',
    'Checking for duplicates…'
  )
  const resolvedDuplicateLinkLabel = duplicateLinkLabel ?? t(
    'ui.inputs.phoneNumberField.duplicateLink',
    'Open record'
  )
  const resolvedPlaceholder = placeholder ?? DEFAULT_PLACEHOLDER
  const countries = countriesProp ?? PHONE_COUNTRIES
  const fallbackCountry = React.useMemo(
    () => (defaultCountryIso2 && findCountryByIso(defaultCountryIso2)) || DEFAULT_COUNTRY,
    [defaultCountryIso2],
  )

  const initialCountry = React.useMemo(
    () => parseCountryFromValue(value) ?? fallbackCountry,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const [country, setCountry] = React.useState<PhoneCountry>(initialCountry)
  const [localNumber, setLocalNumber] = React.useState<string>(() =>
    extractLocalNumber(value, initialCountry.dialCode),
  )
  const [duplicate, setDuplicate] = React.useState<PhoneDuplicateMatch | null>(null)
  const [checking, setChecking] = React.useState(false)
  const [validationHint, setValidationHint] = React.useState<string | null>(null)
  const [focused, setFocused] = React.useState(false)
  const userEditingRef = React.useRef(false)

  const externalFieldError = externalError && externalError.trim().length > 0 ? externalError : null
  const errorMessage = externalFieldError ?? validationHint
  const errorId = errorMessage && id ? `${id}-error` : undefined
  const describedBy = [ariaDescribedBy, errorId].filter((part): part is string => Boolean(part)).join(' ') || undefined
  const composedValue = composeValue(country, localNumber)

  // Sync local state when `value` updates externally and the user is not editing.
  React.useEffect(() => {
    if (userEditingRef.current) return
    if (value == null || value === '') {
      setLocalNumber('')
      onDigitsChange?.(null)
      return
    }
    const parsed = parseCountryFromValue(value)
    if (parsed) setCountry(parsed)
    const next = extractLocalNumber(value, parsed?.dialCode ?? country.dialCode)
    setLocalNumber(next)
    onDigitsChange?.(extractPhoneDigits(String(value)) || null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // Debounced duplicate lookup.
  React.useEffect(() => {
    if (!onDuplicateLookup || disabled) {
      setDuplicate(null)
      setChecking(false)
      return
    }
    const digits = extractPhoneDigits(composedValue)
    if (!digits || digits.length < minDigits) {
      setDuplicate(null)
      setChecking(false)
      return
    }

    let cancelled = false
    setChecking(true)
    const handle = window.setTimeout(async () => {
      try {
        const match = await onDuplicateLookup(digits)
        if (!cancelled) setDuplicate(match)
      } catch {
        if (!cancelled) setDuplicate(null)
      } finally {
        if (!cancelled) setChecking(false)
      }
    }, 350)

    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [composedValue, disabled, minDigits, onDuplicateLookup])

  const emit = React.useCallback(
    (nextCountry: PhoneCountry, nextLocal: string) => {
      const composed = composeValue(nextCountry, nextLocal)
      onValueChange(composed.length ? composed : undefined)
      onDigitsChange?.(extractPhoneDigits(composed) || null)
    },
    [onDigitsChange, onValueChange],
  )

  const handleCountryChange = React.useCallback(
    (iso2: string) => {
      const next = findCountryByIso(iso2)
      if (!next) return
      userEditingRef.current = true
      setCountry(next)
      setValidationHint(null)
      emit(next, localNumber)
    },
    [emit, localNumber],
  )

  const handleLocalChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value
      userEditingRef.current = true
      setLocalNumber(next)
      setValidationHint(null)
      emit(country, next)
    },
    [country, emit],
  )

  const handleBlur = React.useCallback(() => {
    userEditingRef.current = false
    setFocused(false)
    const trimmed = localNumber.trim()
    if (!trimmed) {
      setLocalNumber('')
      setValidationHint(null)
      onValueChange(undefined)
      onDigitsChange?.(null)
      return
    }
    const composed = composeValue(country, trimmed)
    const result = validatePhoneNumber(composed)
    if (result.valid) {
      const normalizedLocal = extractLocalNumber(result.normalized ?? composed, country.dialCode)
      setLocalNumber(normalizedLocal)
      setValidationHint(null)
      onValueChange(result.normalized || undefined)
      onDigitsChange?.(result.digits || null)
    } else {
      setValidationHint(resolvedInvalidLabel)
      onValueChange(composed)
      onDigitsChange?.(result.digits || null)
    }
  }, [country, localNumber, onDigitsChange, onValueChange, resolvedInvalidLabel])

  const containerErrorBorder = errorMessage ? 'border-status-error-icon' : 'border-input'
  const containerFocusBorder = errorMessage
    ? 'border-status-error-icon shadow-focus'
    : 'border-brand-violet shadow-focus'

  return (
    <div className="space-y-2">
      <div
        className={cn(
          'flex items-stretch w-full rounded-md border bg-background shadow-xs transition-colors',
          disabled
            ? 'bg-bg-disabled border-border-disabled cursor-not-allowed'
            : focused
              ? containerFocusBorder
              : `${containerErrorBorder} hover:border-foreground/30`,
        )}
        aria-invalid={errorMessage ? 'true' : undefined}
      >
        <Select value={country.iso2} onValueChange={handleCountryChange} disabled={disabled}>
          <SelectTrigger
            aria-label={ariaLabel ? `${ariaLabel} country` : 'Country code'}
            className={cn(
              'h-auto w-auto shrink-0 gap-1.5 rounded-none rounded-l-md border-0 bg-transparent px-2.5 py-2 shadow-none',
              'hover:bg-muted/40 focus:bg-muted/40 focus-visible:shadow-none focus-visible:border-0',
              'disabled:bg-transparent disabled:hover:bg-transparent',
            )}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          >
            <span className="text-base leading-none" aria-hidden="true">{country.flag}</span>
            <span className="text-sm text-foreground tabular-nums">{country.dialCode}</span>
          </SelectTrigger>
          <SelectContent align="start">
            {countries.map((c) => (
              <SelectItem key={`${c.iso2}-${c.dialCode}`} value={c.iso2}>
                <SelectItemLeading>
                  <span className="text-base leading-none">{c.flag}</span>
                </SelectItemLeading>
                <span className="flex-1 truncate">{c.label}</span>
                <span className="ml-2 text-xs text-muted-foreground tabular-nums">{c.dialCode}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div aria-hidden="true" className="w-px self-stretch bg-input" />
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={localNumber}
          onChange={handleLocalChange}
          onBlur={handleBlur}
          onFocus={() => setFocused(true)}
          placeholder={resolvedPlaceholder}
          autoFocus={autoFocus}
          disabled={disabled}
          id={id}
          aria-label={ariaLabel}
          aria-describedby={describedBy}
          aria-invalid={errorMessage ? 'true' : undefined}
          data-crud-focus-target=""
          className={cn(
            'flex-1 min-w-0 bg-transparent px-3 py-2 text-sm leading-5 outline-none',
            'placeholder:text-muted-foreground',
            'disabled:cursor-not-allowed disabled:text-muted-foreground',
          )}
        />
      </div>
      {errorMessage ? (
        <p id={errorId} role="alert" className="text-xs text-status-error-text">{errorMessage}</p>
      ) : null}
      {!disabled && duplicate && duplicateLabel ? (
        <p className="text-xs text-status-warning-text">
          {duplicateLabel(duplicate)}{' '}
          <a className="font-medium text-brand-violet underline underline-offset-2" href={duplicate.href}>
            {resolvedDuplicateLinkLabel}
          </a>
        </p>
      ) : null}
      {!disabled && !duplicate && checking ? (
        <p className="text-xs text-muted-foreground">{resolvedCheckingLabel}</p>
      ) : null}
    </div>
  )
}
