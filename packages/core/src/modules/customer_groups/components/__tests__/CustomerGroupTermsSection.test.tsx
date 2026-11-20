/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import {
  CustomerGroupTermsSection,
  TERMS_NOT_YET_CREATED_LOCK_TOKEN,
  type CustomerGroupTermsDTO,
} from '../CustomerGroupTermsSection'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/i18n/context'),
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

type MockCrudFormProps = {
  disableInitialFocus?: boolean
  readOnly?: boolean
  readOnlyOverlay?: React.ReactNode
  submitLabel?: string
  optimisticLockUpdatedAt?: string | null
  initialValues?: Record<string, unknown>
  schema?: { safeParse: (value: unknown) => { success: boolean; data?: Record<string, unknown> } }
  fields?: Array<{ id: string; type: string }>
  onSubmit?: (values: Record<string, unknown>) => Promise<void>
}

let lastFormProps: MockCrudFormProps | null = null

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: MockCrudFormProps) => {
    lastFormProps = props
    return (
      <div
        data-testid="terms-form"
        data-read-only={String(props.readOnly === true)}
        data-lock-token={props.optimisticLockUpdatedAt ?? ''}
      >
        {props.readOnly ? props.readOnlyOverlay : <span>{props.submitLabel}</span>}
      </div>
    )
  },
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  updateCrud: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
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
  assortmentScope: null,
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

describe('CustomerGroupTermsSection assortment scope', () => {
  const updateCrudMock = updateCrud as jest.Mock

  beforeEach(() => {
    updateCrudMock.mockReset()
    updateCrudMock.mockResolvedValue({ result: { terms: storedTerms } })
    lastFormProps = null
  })

  const emptyPickers = {
    categoryIds: [],
    tagIds: [],
    excludeProductIds: [],
    excludeCategoryIds: [],
    excludeTagIds: [],
  }

  async function submit(values: Record<string, unknown>) {
    expect(lastFormProps?.onSubmit).toBeDefined()
    await lastFormProps?.onSubmit?.({ allowPurchaseOnAccount: 'inherit', priceKindId: '', creditCurrencyCode: '', ...values })
    await waitFor(() => expect(updateCrudMock).toHaveBeenCalledTimes(1))
    return updateCrudMock.mock.calls[0][1] as Record<string, unknown>
  }

  it('does not auto-focus the first field so no suggestion list opens on load', () => {
    renderSection(storedTerms, true)
    expect(lastFormProps?.disableInitialFocus).toBe(true)
  })

  it('seeds the pickers from the stored scope', () => {
    renderSection(
      {
        ...storedTerms,
        assortmentScope: { categoryIds: ['cat-1'], excludeProductIds: ['prod-1'] },
      },
      true,
    )
    expect(lastFormProps?.initialValues).toMatchObject({
      ...emptyPickers,
      categoryIds: ['cat-1'],
      excludeProductIds: ['prod-1'],
    })
  })

  it('saves assortmentScope null when every picker is cleared', async () => {
    renderSection({ ...storedTerms, assortmentScope: { categoryIds: ['cat-1'] } }, true)
    const payload = await submit(emptyPickers)
    expect(payload.assortmentScope).toBeNull()
  })

  it('saves the include and exclude selections, omitting cleared pickers', async () => {
    renderSection(storedTerms, true)
    const payload = await submit({ ...emptyPickers, categoryIds: ['cat-1'], excludeTagIds: ['tag-2'] })
    expect(payload.assortmentScope).toEqual({ categoryIds: ['cat-1'], excludeTagIds: ['tag-2'] })
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

describe('CustomerGroupTermsSection exact amounts', () => {
  const updateCrudMock = updateCrud as jest.Mock
  const CREDIT_LIMIT = '25.123456789012345678'
  const APPROVAL_ABOVE = '1000.000000000000000001'
  const MIN_ORDER = '0.000000000000000001'
  const exactTerms: CustomerGroupTermsDTO = {
    ...storedTerms,
    defaultCreditLimit: Number(CREDIT_LIMIT),
    defaultCreditLimitExact: CREDIT_LIMIT,
    creditCurrencyCode: 'ETH',
    approvalRequiredAbove: Number(APPROVAL_ABOVE),
    approvalRequiredAboveExact: APPROVAL_ABOVE,
    minOrderValue: Number(MIN_ORDER),
    minOrderValueExact: MIN_ORDER,
  }

  beforeEach(() => {
    updateCrudMock.mockReset()
    updateCrudMock.mockResolvedValue({ result: { terms: exactTerms } })
    lastFormProps = null
  })

  it('edits the amounts as exact decimal fields seeded from the exact siblings', () => {
    renderSection(exactTerms, true)
    expect(lastFormProps?.initialValues).toMatchObject({
      defaultCreditLimit: CREDIT_LIMIT,
      approvalRequiredAbove: APPROVAL_ABOVE,
      minOrderValue: MIN_ORDER,
    })
    const amountFieldTypes = (lastFormProps?.fields ?? [])
      .filter((field) => ['defaultCreditLimit', 'approvalRequiredAbove', 'minOrderValue'].includes(field.id))
      .map((field) => field.type)
    expect(amountFieldTypes).toEqual(['decimal', 'decimal', 'decimal'])
  })

  it('keeps every stored digit when only the payment days change', async () => {
    renderSection(exactTerms, true)
    const parsed = lastFormProps?.schema?.safeParse({ ...lastFormProps?.initialValues, paymentTermsDays: 45 })
    expect(parsed?.success).toBe(true)
    await lastFormProps?.onSubmit?.(parsed?.data ?? {})
    await waitFor(() => expect(updateCrudMock).toHaveBeenCalledTimes(1))
    expect(updateCrudMock.mock.calls[0][1]).toMatchObject({
      paymentTermsDays: 45,
      defaultCreditLimit: CREDIT_LIMIT,
      creditCurrencyCode: 'ETH',
      approvalRequiredAbove: APPROVAL_ABOVE,
      minOrderValue: MIN_ORDER,
    })
  })

  it('falls back to the float copy for terms mapped without exact siblings', () => {
    renderSection({ ...storedTerms, defaultCreditLimit: 1500.5 }, true)
    expect(lastFormProps?.initialValues).toMatchObject({ defaultCreditLimit: '1500.5' })
  })

  it('rejects negative amounts and clears empty ones', () => {
    renderSection(exactTerms, true)
    const base = { ...lastFormProps?.initialValues }
    expect(lastFormProps?.schema?.safeParse({ ...base, minOrderValue: '-0.01' }).success).toBe(false)
    const cleared = lastFormProps?.schema?.safeParse({ ...base, minOrderValue: undefined })
    expect(cleared?.success).toBe(true)
    expect(cleared?.data?.minOrderValue).toBeUndefined()
  })
})
