/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const apiCallMock = jest.fn()
const routerPushMock = jest.fn()
const portalAuthState = { auth: { user: { id: 'customer-user-1' }, loading: false } }

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: routerPushMock }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/ui/portal/PortalContext', () => ({
  usePortalContext: () => portalAuthState,
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async <T,>({ operation }: { operation: () => Promise<T> }) => operation(),
    retryLastMutation: async () => true,
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

import enDict from '../i18n/en.json'
import WarrantyClaimPortalNewPage from '../frontend/[orgSlug]/portal/claims/new/page'

// The portal new-claim wizard must NOT create the claim until the customer is on the
// "Review & submit" step and explicitly confirms — advancing steps and submitting are
// separate actions (WQA-003 / #5284). The bug was a single handler that both advanced the
// step and (on the last-but-one step) submitted. This source-contract test guards the
// decoupling; it fails on the pre-fix shape where `handleSubmit` called `goNext()`.
const source = readFileSync(
  join(__dirname, '../frontend/[orgSlug]/portal/claims/new/page.tsx'),
  'utf8',
)

function functionBody(name: string): string {
  const start = source.indexOf(`const ${name} = React.useCallback`)
  if (start === -1) throw new Error(`function ${name} not found`)
  const end = source.indexOf('}, [', start)
  return source.slice(start, end === -1 ? undefined : end)
}

describe('portal new-claim wizard only submits from the Review step (#5284)', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: class ResizeObserverMock {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    })
  })

  beforeEach(() => {
    jest.clearAllMocks()
    apiCallMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === '/api/warranty_claims/portal/options') {
        return { ok: true, status: 200, result: { ok: true, result: { reasons: [], faultCodes: [] } } }
      }
      if (url.startsWith('/api/warranty_claims/portal/orders?')) {
        return { ok: true, status: 200, result: { ok: true, items: [], total: 0, page: 1, pageSize: 50 } }
      }
      if (url.startsWith('/api/warranty_claims/portal/troubleshooting?')) {
        return { ok: true, status: 200, result: { guide: null } }
      }
      if (url === '/api/warranty_claims/portal/claims' && options?.method === 'POST') {
        return { ok: true, status: 200, result: { ok: true, claimId: 'claim-new' } }
      }
      throw new Error(`[internal] Unexpected apiCall in test: ${url}`)
    })
  })

  it('waits on Review after the Details Next click and submits only after confirmation', async () => {
    const view = renderWithProviders(
      React.createElement(WarrantyClaimPortalNewPage, { params: { orgSlug: 'acme-corp' } }),
      { dict: enDict },
    )

    fireEvent.click(view.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(view.getByText('Claim lines')).toBeTruthy())

    const faultDescription = view.getByText('Fault description')
      .closest('[data-slot="form-field"]')?.querySelector('textarea')
    if (!faultDescription) throw new Error('[internal] Fault description field not found')
    fireEvent.change(faultDescription, { target: { value: 'Broken buckle' } })
    fireEvent.click(view.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(view.getByText('Claim details')).toBeTruthy())

    const reason = view.getByText('Reason')
      .closest('[data-slot="form-field"]')?.querySelector('input')
    if (!reason) throw new Error('[internal] Reason field not found')
    fireEvent.change(reason, { target: { value: 'warranty-defect' } })
    const detailsNextClickAccepted = fireEvent.click(view.getByRole('button', { name: 'Next' }))
    expect(detailsNextClickAccepted).toBe(false)
    await waitFor(() => expect(view.getByText('Notes and review')).toBeTruthy())

    const createCallsBeforeConfirmation = apiCallMock.mock.calls.filter(
      ([url, options]) => url === '/api/warranty_claims/portal/claims' && options?.method === 'POST',
    )
    expect(createCallsBeforeConfirmation).toHaveLength(0)
    expect(routerPushMock).not.toHaveBeenCalled()

    fireEvent.click(view.getByRole('button', { name: 'Submit claim' }))
    await waitFor(() => expect(routerPushMock).toHaveBeenCalledWith('/acme-corp/portal/claims/claim-new'))

    const createCallsAfterConfirmation = apiCallMock.mock.calls.filter(
      ([url, options]) => url === '/api/warranty_claims/portal/claims' && options?.method === 'POST',
    )
    expect(createCallsAfterConfirmation).toHaveLength(1)
  })

  it('handleSubmit finalizes only when currentStep === review and never advances steps', () => {
    const body = functionBody('handleSubmit')
    expect(body).toContain("currentStep === 'review'")
    expect(body).toContain('submitClaim()')
    // The pre-fix bug: handleSubmit fell through to goNext() for non-review steps.
    expect(body).not.toContain('goNext(')
  })

  it('goNext advances the step but never submits the claim', () => {
    const body = functionBody('goNext')
    expect(body).toContain('event.preventDefault()')
    expect(body).toContain('setCurrentStep(')
    expect(body).not.toContain('submitClaim')
  })

  it('the Next control is a plain button and the Review control is the only submit button', () => {
    // Non-review steps render an explicit type="button" Next wired to goNext (cannot submit the form).
    expect(source).toContain('onClick={goNext}')
    expect(source).toMatch(/type="button"[\s\S]{0,120}onClick=\{goNext\}/)
    // The review step renders the single type="submit" send button.
    expect(source).toContain('type="submit"')
    expect(source).toContain("t('warranty_claims.portal.submit')")
  })

  it('the claim-create POST lives only inside submitClaim', () => {
    const occurrences = source.split("'/api/warranty_claims/portal/claims'").length - 1
    expect(occurrences).toBe(1)
    const submitClaim = functionBody('submitClaim')
    expect(submitClaim).toContain("'/api/warranty_claims/portal/claims'")
  })
})
