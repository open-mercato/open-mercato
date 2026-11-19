/**
 * @jest-environment jsdom
 *
 * Regression test for issue #9873.
 *
 * A checkout link's `customerFieldsSchema` snapshots each built-in field's label in whatever
 * locale was active when the link was created, so a link created against the English admin UI
 * stored "First name" / "Phone" / "Address" permanently, even though the rest of the public pay
 * page re-translates its copy through `useT()` on every render. Buyers who switched the page to
 * Polish saw a correctly translated amount and payment copy next to English customer-detail
 * labels. `PayPageCustomerForm` must now re-resolve an untouched built-in label through the
 * active locale while leaving an operator's explicit customization untouched.
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

jest.mock('lucide-react', () => {
  const IconStub = () => null
  return new Proxy(
    { __esModule: true },
    { get: (target, prop) => (prop in target ? (target as Record<string | symbol, unknown>)[prop] : IconStub) },
  )
})

jest.mock('next/navigation', () => ({
  useParams: () => ({}),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const TRANSLATIONS: Record<string, Record<string, string>> = {
  en: {
    'checkout.defaultCustomerFields.firstName.label': 'First name',
    'checkout.defaultCustomerFields.lastName.label': 'Last name',
    'checkout.defaultCustomerFields.phone.label': 'Phone',
    'checkout.defaultCustomerFields.companyName.label': 'Company name',
    'checkout.defaultCustomerFields.companyId.label': 'Company ID',
    'checkout.defaultCustomerFields.address.label': 'Address',
  },
  pl: {
    'checkout.defaultCustomerFields.firstName.label': 'Imię',
    'checkout.defaultCustomerFields.lastName.label': 'Nazwisko',
    'checkout.defaultCustomerFields.phone.label': 'Telefon',
    'checkout.defaultCustomerFields.companyName.label': 'Nazwa firmy',
    'checkout.defaultCustomerFields.companyId.label': 'NIP / ID firmy',
    'checkout.defaultCustomerFields.address.label': 'Adres',
  },
}

let activeLocale: 'en' | 'pl' = 'en'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: unknown) => {
    const dictionary = TRANSLATIONS[activeLocale] ?? {}
    if (key in dictionary) return dictionary[key]
    return typeof fallback === 'string' ? fallback : key
  },
  useLocale: () => activeLocale,
  useSupportedLocales: () => ['en', 'pl'],
}))

import { PayPageCustomerForm, type PayLinkPayload, type PayPageThemeTokens } from '../PayPage'

const THEME_TOKENS: PayPageThemeTokens = {
  mode: 'light',
  accent: '#000000',
  accentSecondary: '#000000',
  accentContrast: '#ffffff',
  text: '#000000',
  mutedText: '#666666',
  pageBackground: '#ffffff',
  shellBackground: '#ffffff',
  surface: '#ffffff',
  surfaceMuted: '#f5f5f5',
  surfaceStrong: '#eeeeee',
  border: '#dddddd',
  borderStrong: '#cccccc',
  shadow: 'none',
  accentShadow: 'none',
  heroBackground: '#ffffff',
  errorText: '#b00020',
  errorBorder: '#b00020',
  errorSurface: '#fdecea',
  errorSurfaceStrong: '#fbd9d6',
  errorRing: '#b00020',
}

// A link created against the English admin UI before this fix shipped: the stored labels are
// the untranslated defaults, indistinguishable at the data layer from an operator who happens to
// want English labels — the only way to tell them apart is to compare against the known default.
function buildPayload(overrides?: Partial<PayLinkPayload>): PayLinkPayload {
  return {
    id: 'link-1',
    name: 'Test link',
    pricingMode: 'fixed',
    collectCustomerDetails: true,
    customerFieldsSchema: [
      { key: 'firstName', label: 'First name', kind: 'text', required: true, sortOrder: 0 },
      { key: 'lastName', label: 'Last name', kind: 'text', required: true, sortOrder: 1 },
      { key: 'phone', label: 'Phone', kind: 'text', required: false, sortOrder: 2 },
      { key: 'companyName', label: 'Company name', kind: 'text', required: false, sortOrder: 3 },
      { key: 'companyId', label: 'Company ID', kind: 'text', required: false, sortOrder: 4 },
      { key: 'address', label: 'Address', kind: 'multiline', required: false, sortOrder: 5 },
    ],
    ...overrides,
  } as PayLinkPayload
}

// `firstName`/`lastName` are required, so their rendered label text node is followed by a
// sibling " *" text node within the same <label> — matching the exact label text needs a
// startsWith matcher instead of RTL's default exact-string comparison.
function startsWith(text: string) {
  return (content: string) => content.startsWith(text)
}

function renderCustomerForm(payload: PayLinkPayload) {
  return render(
    <PayPageCustomerForm
      payload={payload}
      customerData={{}}
      fieldErrors={{}}
      inputsLocked={false}
      onFieldChange={jest.fn()}
      translateValidationMessage={(message) => message ?? ''}
      themeTokens={THEME_TOKENS}
    />,
  )
}

describe('PayPageCustomerForm built-in label localization (issue #9873)', () => {
  afterEach(() => {
    activeLocale = 'en'
  })

  it('renders the stored English default labels unchanged when the viewer is in English', () => {
    activeLocale = 'en'
    renderCustomerForm(buildPayload())

    expect(screen.getByText(startsWith('First name'))).toBeInTheDocument()
    expect(screen.getByText(startsWith('Last name'))).toBeInTheDocument()
    expect(screen.getByText('Phone')).toBeInTheDocument()
    expect(screen.getByText('Company name')).toBeInTheDocument()
    expect(screen.getByText('Company ID')).toBeInTheDocument()
    expect(screen.getByText('Address')).toBeInTheDocument()
  })

  it('re-renders the same stored labels in Polish when the viewer switches locale', () => {
    activeLocale = 'pl'
    renderCustomerForm(buildPayload())

    expect(screen.getByText(startsWith('Imię'))).toBeInTheDocument()
    expect(screen.getByText(startsWith('Nazwisko'))).toBeInTheDocument()
    expect(screen.getByText('Telefon')).toBeInTheDocument()
    expect(screen.getByText('Nazwa firmy')).toBeInTheDocument()
    expect(screen.getByText('NIP / ID firmy')).toBeInTheDocument()
    expect(screen.getByText('Adres')).toBeInTheDocument()
    expect(screen.queryByText(startsWith('First name'))).not.toBeInTheDocument()
  })

  it('preserves an operator-customized label instead of translating it', () => {
    activeLocale = 'pl'
    const payload = buildPayload({
      customerFieldsSchema: [
        { key: 'firstName', label: 'First name', kind: 'text', required: true, sortOrder: 0 },
        { key: 'phone', label: 'Mobile number', kind: 'text', required: false, sortOrder: 1 },
      ],
    })
    renderCustomerForm(payload)

    expect(screen.getByText(startsWith('Imię'))).toBeInTheDocument()
    expect(screen.getByText('Mobile number')).toBeInTheDocument()
    expect(screen.queryByText('Telefon')).not.toBeInTheDocument()
  })
})
