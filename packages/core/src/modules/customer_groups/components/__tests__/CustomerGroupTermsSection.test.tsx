/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  CustomerGroupTermsSection,
  TERMS_NOT_YET_CREATED_LOCK_TOKEN,
  type CustomerGroupTermsDTO,
} from '../CustomerGroupTermsSection'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/i18n/context'),
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: {
    readOnly?: boolean
    readOnlyOverlay?: React.ReactNode
    submitLabel?: string
    optimisticLockUpdatedAt?: string | null
  }) => (
    <div
      data-testid="terms-form"
      data-read-only={String(props.readOnly === true)}
      data-lock-token={props.optimisticLockUpdatedAt ?? ''}
    >
      {props.readOnly ? props.readOnlyOverlay : <span>{props.submitLabel}</span>}
    </div>
  ),
}))

jest.mock('../CustomerGroupTermsPriceKindField', () => ({
  CustomerGroupTermsPriceKindField: () => null,
}))

const storedTerms: CustomerGroupTermsDTO = {
  id: 'terms-1',
  groupId: 'group-1',
  organizationId: null,
  tenantId: 'tenant-1',
  priceKindId: null,
  paymentTermsDays: 30,
  allowPurchaseOnAccount: true,
  defaultCreditLimit: null,
  creditCurrencyCode: null,
  approvalRequiredAbove: null,
  minOrderValue: null,
  metadata: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
}

function renderSection(terms: CustomerGroupTermsDTO | null, canManage: boolean) {
  return render(
    <CustomerGroupTermsSection
      groupId="group-1"
      terms={terms}
      loading={false}
      canManage={canManage}
      onSaved={() => {}}
    />,
  )
}

describe('CustomerGroupTermsSection permission gating', () => {
  it('offers the "set terms" action on the empty state only with terms.manage', () => {
    const { unmount } = renderSection(null, true)
    expect(screen.getByRole('button', { name: 'Set terms for this group' })).toBeTruthy()
    unmount()

    renderSection(null, false)
    expect(screen.getByText('No terms set — inheriting from parent / tenant defaults')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Set terms for this group' })).toBeNull()
  })

  it('renders stored terms read-only without terms.manage', () => {
    renderSection(storedTerms, false)
    expect(screen.getByTestId('terms-form').getAttribute('data-read-only')).toBe('true')
    expect(screen.getByText('You do not have permission to change commercial terms.')).toBeTruthy()
    expect(screen.queryByText('Save terms')).toBeNull()
  })

  it('keeps stored terms editable with terms.manage', () => {
    renderSection(storedTerms, true)
    expect(screen.getByTestId('terms-form').getAttribute('data-read-only')).toBe('false')
    expect(screen.getByText('Save terms')).toBeTruthy()
  })
})

describe('CustomerGroupTermsSection optimistic locking', () => {
  it('sends a lock token on the first save so a concurrent first save cannot be overwritten', () => {
    renderSection(null, true)
    fireEvent.click(screen.getByRole('button', { name: 'Set terms for this group' }))
    const token = screen.getByTestId('terms-form').getAttribute('data-lock-token')
    expect(token).toBe(TERMS_NOT_YET_CREATED_LOCK_TOKEN)
    expect(token).toBe('1970-01-01T00:00:00.000Z')
  })

  it('sends the stored row version once terms exist', () => {
    renderSection(storedTerms, true)
    expect(screen.getByTestId('terms-form').getAttribute('data-lock-token')).toBe(storedTerms.updatedAt)
  })
})
