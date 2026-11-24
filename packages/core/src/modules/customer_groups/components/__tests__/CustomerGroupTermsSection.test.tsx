/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import {
  CustomerGroupTermsSection,
  TERMS_NOT_YET_CREATED_LOCK_TOKEN,
  type CustomerGroupInheritedTermsDTO,
  type CustomerGroupTermsDTO,
} from '../CustomerGroupTermsSection'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/i18n/context'),
  useT: () => (_key: string, fallback?: string, params?: Record<string, string>) =>
    (fallback ?? _key).replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match),
}))

type MockCrudFormProps = {
  disableInitialFocus?: boolean
  readOnly?: boolean
  readOnlyOverlay?: React.ReactNode
  submitLabel?: string
  optimisticLockUpdatedAt?: string | null
  initialValues?: Record<string, unknown>
  schema?: { safeParse: (value: unknown) => { success: boolean; data?: Record<string, unknown> } }
  fields?: Array<{
    id: string
    type: string
    description?: React.ReactNode
    component?: (props: { values?: Record<string, unknown> }) => React.ReactNode
  }>
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

function renderSection(
  terms: CustomerGroupTermsDTO | null,
  canManage: boolean,
  isDefaultGroup = false,
  inherited: CustomerGroupInheritedTermsDTO | null = null,
) {
  return render(
    <CustomerGroupTermsSection
      groupId="group-1"
      terms={terms}
      loading={false}
      canManage={canManage}
      isDefaultGroup={isDefaultGroup}
      inherited={inherited}
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

describe('CustomerGroupTermsSection Release 5 terms', () => {
  const updateCrudMock = updateCrud as jest.Mock

  beforeEach(() => {
    updateCrudMock.mockReset()
    updateCrudMock.mockResolvedValue({ result: { terms: storedTerms } })
    lastFormProps = null
  })

  function renderWarnings(values: Record<string, unknown>) {
    const warningsField = (lastFormProps?.fields ?? []).find((field) => field.id === 'termsWarnings')
    expect(warningsField?.component).toBeDefined()
    return render(<>{warningsField?.component?.({ values })}</>)
  }

  it('seeds the four fields as inherit when the stored row leaves them unset', () => {
    renderSection(storedTerms, true)
    expect(lastFormProps?.initialValues).toMatchObject({
      termsCurrencyCode: '',
      approvalPolicy: 'inherit',
      allowQuoteRequests: 'inherit',
      requiresPoNumber: 'inherit',
    })
  })

  it('seeds explicit stored values', () => {
    renderSection(
      { ...storedTerms, termsCurrencyCode: 'EUR', approvalPolicy: 'merchant', allowQuoteRequests: true, requiresPoNumber: false },
      true,
    )
    expect(lastFormProps?.initialValues).toMatchObject({
      termsCurrencyCode: 'EUR',
      approvalPolicy: 'merchant',
      allowQuoteRequests: 'allow',
      requiresPoNumber: 'deny',
    })
  })

  it('saves explicit values, uppercasing the currency, and inherit as null', async () => {
    renderSection(storedTerms, true)
    await lastFormProps?.onSubmit?.({
      ...lastFormProps?.initialValues,
      termsCurrencyCode: ' pln ',
      approvalPolicy: 'both',
      allowQuoteRequests: 'allow',
      requiresPoNumber: 'inherit',
    })
    await waitFor(() => expect(updateCrudMock).toHaveBeenCalledTimes(1))
    expect(updateCrudMock.mock.calls[0][1]).toMatchObject({
      termsCurrencyCode: 'PLN',
      approvalPolicy: 'both',
      allowQuoteRequests: true,
      requiresPoNumber: null,
    })
  })

  it('accepts only a three-letter currency code', () => {
    renderSection(storedTerms, true)
    const base = { ...lastFormProps?.initialValues }
    expect(lastFormProps?.schema?.safeParse({ ...base, termsCurrencyCode: 'EURO' }).success).toBe(false)
    expect(lastFormProps?.schema?.safeParse({ ...base, termsCurrencyCode: 'E1R' }).success).toBe(false)
    expect(lastFormProps?.schema?.safeParse({ ...base, termsCurrencyCode: 'eur' }).success).toBe(true)
    expect(lastFormProps?.schema?.safeParse({ ...base, termsCurrencyCode: '' }).success).toBe(true)
  })

  it('warns on the default group that an approval threshold blocks guest orders', () => {
    renderSection(storedTerms, true, true)
    renderWarnings({ approvalRequiredAbove: '500', termsCurrencyCode: 'EUR' })
    expect(screen.getByTestId('customer-group-terms-default-group-warning')).toBeTruthy()
    expect(screen.queryByTestId('customer-group-terms-missing-currency-warning')).toBeNull()
  })

  it('does not show the default-group warning on other groups', () => {
    renderSection(storedTerms, true, false)
    renderWarnings({ approvalRequiredAbove: '500', termsCurrencyCode: 'EUR' })
    expect(screen.queryByTestId('customer-group-terms-default-group-warning')).toBeNull()
  })

  it('warns when a threshold or minimum has no terms currency', () => {
    renderSection(storedTerms, true)
    const { unmount } = renderWarnings({ minOrderValue: '10', termsCurrencyCode: '' })
    expect(screen.getByTestId('customer-group-terms-missing-currency-warning')).toBeTruthy()
    unmount()
    renderWarnings({ termsCurrencyCode: '' })
    expect(screen.queryByTestId('customer-group-terms-missing-currency-warning')).toBeNull()
  })
})

describe('CustomerGroupTermsSection inherited terms on a child group', () => {
  const parentGroup = { id: 'parent-1', code: 'parent', name: 'Parent group' }
  const tenantDefault = { source: 'tenant_default' as const, sourceGroup: null }
  const parentInherited: CustomerGroupInheritedTermsDTO = {
    paymentTermsDays: { value: null, ...tenantDefault },
    allowPurchaseOnAccount: { value: false, ...tenantDefault },
    approvalRequiredAbove: { value: 500, source: 'group', sourceGroup: parentGroup },
    minOrderValue: { value: null, ...tenantDefault },
    termsCurrencyCode: { value: 'EUR', source: 'group', sourceGroup: parentGroup },
    approvalPolicy: { value: 'merchant', source: 'group', sourceGroup: parentGroup },
    allowQuoteRequests: { value: false, ...tenantDefault },
    requiresPoNumber: { value: false, ...tenantDefault },
  }

  beforeEach(() => {
    lastFormProps = null
  })

  function renderFieldDescription(fieldId: string) {
    const field = (lastFormProps?.fields ?? []).find((entry) => entry.id === fieldId)
    return render(<>{field?.description}</>)
  }

  function renderWarnings(values: Record<string, unknown>) {
    const warningsField = (lastFormProps?.fields ?? []).find((field) => field.id === 'termsWarnings')
    return render(<>{warningsField?.component?.({ values })}</>)
  }

  it('shows the inherited approval policy and currency with the parent group as their source', () => {
    renderSection(null, true, false, parentInherited)
    fireEvent.click(screen.getByRole('button', { name: 'Set terms for this group' }))
    renderFieldDescription('approvalPolicy')
    expect(screen.getByTestId('customer-group-terms-inherited-approvalPolicy').textContent).toBe(
      'Inherited: Merchant (from Parent group)',
    )
    renderFieldDescription('termsCurrencyCode')
    expect(screen.getByTestId('customer-group-terms-inherited-termsCurrencyCode').textContent).toBe(
      'Inherited: EUR (from Parent group)',
    )
    renderFieldDescription('requiresPoNumber')
    expect(screen.getByTestId('customer-group-terms-inherited-requiresPoNumber').textContent).toBe(
      'Inherited: Do not require (tenant default)',
    )
  })

  it('names the organization base currency as the source of an inherited currency', () => {
    renderSection(storedTerms, true, false, {
      ...parentInherited,
      termsCurrencyCode: { value: 'PLN', source: 'base_currency', sourceGroup: null },
    })
    renderFieldDescription('termsCurrencyCode')
    expect(screen.getByTestId('customer-group-terms-inherited-termsCurrencyCode').textContent).toBe(
      'Inherited: PLN (organization base currency)',
    )
  })

  it('does not warn about a missing currency when the parent supplies one', () => {
    renderSection(storedTerms, true, false, parentInherited)
    renderWarnings({ minOrderValue: '10', termsCurrencyCode: '' })
    expect(screen.queryByTestId('customer-group-terms-missing-currency-warning')).toBeNull()
  })

  it('warns when the threshold is inherited and no currency resolves anywhere', () => {
    renderSection(storedTerms, true, false, {
      ...parentInherited,
      termsCurrencyCode: { value: null, ...tenantDefault },
    })
    renderWarnings({ termsCurrencyCode: '' })
    expect(screen.getByTestId('customer-group-terms-missing-currency-warning').textContent).toContain(
      'No terms currency resolves for this group',
    )
  })
})
