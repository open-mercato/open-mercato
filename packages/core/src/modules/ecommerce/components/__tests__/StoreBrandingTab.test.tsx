/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import { StoreBrandingTab } from '../StoreBrandingTab'
import type { StoreAdminRecord } from '../storeAdmin'
import type { StoreAccess } from '../useStoreAccess'

type CapturedField = { id: string; type: string; disabled?: boolean }
type CapturedGroup = {
  id: string
  fields?: string[]
  component?: (context: { values: Record<string, unknown> }) => React.ReactNode
}
type CapturedForm = {
  fields: CapturedField[]
  groups: CapturedGroup[]
  schema: { safeParse: (value: unknown) => { success: boolean } }
  initialValues: Record<string, string>
  optimisticLockUpdatedAt?: string | null
  hideFooterActions?: boolean
  embedded?: boolean
  onSubmit: (values: Record<string, string>) => Promise<void>
}

const apiCallMock = jest.fn()
const raiseCrudErrorMock = jest.fn()
const flashMock = jest.fn()
const forms: CapturedForm[] = []
let access: StoreAccess

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  raiseCrudError: (...args: unknown[]) => raiseCrudErrorMock(...args),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: (...args: unknown[]) => flashMock(...args) }))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: CapturedForm) => {
    forms.push(props)
    return <div data-testid="branding-form" />
  },
}))

jest.mock('../useStoreAccess', () => ({
  useStoreAccess: () => access,
}))

const store: StoreAdminRecord = {
  id: 'store-1',
  code: 'main',
  name: 'Main store',
  slug: 'main-shop',
  status: 'active',
  defaultLocale: 'en',
  supportedLocales: ['en'],
  defaultCurrencyCode: 'EUR',
  isPrimary: true,
  settings: { contact: { email: 'shop@example.com' }, branding: { primaryColor: '#112233', logoUrl: 'https://cdn.example.com/logo.png' } },
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
}

function lastForm(): CapturedForm {
  const form = forms[forms.length - 1]
  if (!form) throw new Error('[internal] no form captured')
  return form
}

function renderTab(target: StoreAdminRecord = store, reload: () => Promise<void> = jest.fn().mockResolvedValue(undefined)) {
  render(<StoreBrandingTab store={target} reload={reload} />)
  return reload
}

function renderPreview(values: Record<string, unknown>) {
  const group = lastForm().groups.find((candidate) => candidate.id === 'preview')
  if (!group?.component) throw new Error('[internal] no preview group')
  return render(<>{group.component({ values })}</>)
}

function previewDocument(): string {
  return screen.getByTestId('branding-preview-frame').getAttribute('srcdoc') ?? ''
}

describe('StoreBrandingTab', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    apiCallMock.mockReset().mockResolvedValue({ ok: true, status: 200, result: { id: 'store-1' } })
    raiseCrudErrorMock.mockReset().mockRejectedValue(new Error('[internal] rejected'))
    flashMock.mockReset()
    forms.length = 0
    access = { isResolved: true, canManage: true, canManageBranding: true, canViewAvailability: true, canManageAvailability: true }
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('prefills the documented defaults for unset fields and stored values for set ones, with the store version as the lock', () => {
    renderTab()
    const form = lastForm()
    expect(form.embedded).toBe(true)
    expect(form.optimisticLockUpdatedAt).toBe('2026-10-02T10:00:00.000Z')
    expect(form.initialValues.primaryColor).toBe('#112233')
    expect(form.initialValues.accentColor).toBe('oklch(0.97 0 0)')
    expect(form.initialValues.borderRadius).toBe('0.625rem')
    expect(form.initialValues.fontFamilyBase).toBe('inter')
    expect(form.initialValues.logoUrl).toBe('https://cdn.example.com/logo.png')
    expect(form.fields.map((field) => field.id)).toEqual([
      'primaryColor',
      'primaryForeground',
      'accentColor',
      'accentForeground',
      'backgroundColor',
      'foregroundColor',
      'borderRadius',
      'fontFamilyBase',
      'fontFamilyHeading',
      'logoUrl',
      'faviconUrl',
    ])
  })

  it('rejects invalid colour, font, radius and url values before submit', () => {
    renderTab()
    const form = lastForm()
    expect(form.schema.safeParse(form.initialValues).success).toBe(true)
    expect(form.schema.safeParse({ ...form.initialValues, primaryColor: 'not-a-colour' }).success).toBe(false)
    expect(form.schema.safeParse({ ...form.initialValues, fontFamilyBase: 'comic-sans' }).success).toBe(false)
  })

  it('saves the full branding set to the branding route and refreshes the store', async () => {
    const reload = renderTab()
    const form = lastForm()
    await form.onSubmit({ ...form.initialValues, accentColor: '#ff00aa', fontFamilyHeading: 'poppins' })
    expect(apiCallMock).toHaveBeenCalledTimes(1)
    const [url, init] = apiCallMock.mock.calls[0] as [string, { method: string; body: string }]
    expect(url).toBe('/api/ecommerce/stores/store-1/branding')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({
      primaryColor: '#112233',
      accentColor: '#ff00aa',
      fontFamilyHeading: 'poppins',
      logoUrl: 'https://cdn.example.com/logo.png',
    })
    expect(flashMock).toHaveBeenCalledWith('Branding saved', 'success')
    expect(reload).toHaveBeenCalled()
  })

  it('raises a failed save so the form maps the 400 field errors onto their fields', async () => {
    renderTab()
    const form = lastForm()
    apiCallMock.mockResolvedValue({
      ok: false,
      status: 400,
      response: { status: 400 },
      result: { error: 'Colour is invalid', fieldErrors: { primaryColor: 'Colour is invalid' } },
    })
    await expect(form.onSubmit({ ...form.initialValues })).rejects.toThrow('[internal] rejected')
    expect(raiseCrudErrorMock).toHaveBeenCalledWith({ status: 400 }, 'Failed to save the branding.')
    expect(flashMock).not.toHaveBeenCalled()
  })

  it('is view-only without the branding permission, even for store managers', () => {
    access = { isResolved: true, canManage: true, canManageBranding: false, canViewAvailability: true, canManageAvailability: true }
    renderTab()
    const form = lastForm()
    expect(form.hideFooterActions).toBe(true)
    expect(form.fields.every((field) => field.disabled === true)).toBe(true)
    expect(screen.getByText(/permission to manage store branding/i)).toBeTruthy()
  })

  it('is editable with the branding permission alone', () => {
    access = { isResolved: true, canManage: false, canManageBranding: true, canViewAvailability: false, canManageAvailability: false }
    renderTab()
    const form = lastForm()
    expect(form.hideFooterActions).toBe(false)
    expect(form.fields.some((field) => field.disabled === true)).toBe(false)
  })

  describe('live preview', () => {
    it('renders in a script-less sandbox with the branding CSS variables from validated values', () => {
      renderTab()
      renderPreview({ ...lastForm().initialValues, accentColor: '#ff00aa', borderRadius: '2rem' })
      act(() => {
        jest.advanceTimersByTime(300)
      })
      const frame = screen.getByTestId('branding-preview-frame')
      expect(frame.getAttribute('sandbox')).toBe('')
      const document = previewDocument()
      expect(document).toContain('--accent:#ff00aa')
      expect(document).toContain('--radius:2rem')
      expect(document).toContain('Main store')
    })

    it('debounces updates and never lets invalid input reach the iframe', () => {
      renderTab()
      const view = renderPreview({ ...lastForm().initialValues, primaryColor: '#112233' })
      act(() => {
        jest.advanceTimersByTime(300)
      })
      const attack = 'red;}</style><script>alert(1)</script>'
      const group = lastForm().groups.find((candidate) => candidate.id === 'preview')
      view.rerender(
        <>
          {group?.component?.({ values: { ...lastForm().initialValues, primaryColor: attack, fontFamilyBase: attack, logoUrl: 'javascript:alert(1)' } })}
        </>,
      )
      expect(previewDocument()).toContain('--primary:#112233')
      act(() => {
        jest.advanceTimersByTime(300)
      })
      const document = previewDocument()
      expect(document).not.toContain('alert(1)')
      expect(document).not.toContain('<script')
      expect(document).toContain('--primary:oklch(0.205 0 0)')
      expect(apiCallMock).not.toHaveBeenCalled()
    })
  })
})
