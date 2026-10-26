/**
 * @jest-environment jsdom
 */
// The promotion detail page's metadata `CrudForm` and its independently-fetched
// `RuleTreeBuilder` section both carry the promotion's `updatedAt` for the optimistic-lock
// header. Pins that each save surface refreshes the OTHER's version after its own save
// succeeds — `onSubmit` bumps `reloadToken` (refetches `record`, and via `refreshSignal`
// tells `RuleTreeBuilder` to refresh its own version), and `RuleTreeBuilder`'s `onSaved`
// bumps `treeVersionToken` (refetches `record` in turn) — so neither surface can send a
// stale version and get a spurious 409 on a second save.

import * as React from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import PromotionDetailPage from '../page'

type CrudFormCapturedProps = {
  initialValues?: { updatedAt?: string }
  onSubmit?: (values: Record<string, unknown>) => Promise<void>
}
type RuleTreeBuilderCapturedProps = {
  refreshSignal?: number
  onSaved?: () => void
}

const crudFormPropsCapture: { current: CrudFormCapturedProps | null } = { current: null }
const ruleTreeBuilderPropsCapture: { current: RuleTreeBuilderCapturedProps | null } = { current: null }
const apiCallMock = jest.fn()
const updateCrudMock = jest.fn()

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageHeader: () => <div>header</div>,
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  ErrorMessage: ({ label }: { label: string }) => <div data-testid="error-message">{label}</div>,
  LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
  RecordNotFoundState: ({ label }: { label: string }) => <div data-testid="record-not-found">{label}</div>,
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: CrudFormCapturedProps) => {
    crudFormPropsCapture.current = props
    return <div>form</div>
  },
}))

jest.mock('../../../../components/RuleTreeBuilder', () => ({
  RuleTreeBuilder: (props: RuleTreeBuilderCapturedProps) => {
    ruleTreeBuilderPropsCapture.current = props
    return <div>tree</div>
  },
}))

jest.mock('../../../../components/promotionFormFields', () => ({
  createPromotionFormFields: () => [],
  createPromotionFormGroups: () => [],
  createPromotionFormSchema: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  updateCrud: (...args: unknown[]) => updateCrudMock(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

function makeRecord(updatedAt: string) {
  return {
    id: 'promotion-1',
    name: 'Spring sale',
    description: null,
    active: true,
    startsAt: null,
    endsAt: null,
    cumulative: false,
    tags: [],
    excludedTags: [],
    excludeFlags: {},
    eligibleCurrencies: [],
    maxBudget: null,
    budgetCurrency: null,
    updatedAt,
  }
}

describe('PromotionDetailPage', () => {
  beforeEach(() => {
    crudFormPropsCapture.current = null
    ruleTreeBuilderPropsCapture.current = null
    apiCallMock.mockReset()
    updateCrudMock.mockReset()
  })

  it('refreshes record.updatedAt after a CrudForm save, and signals RuleTreeBuilder to refresh its own version', async () => {
    apiCallMock
      .mockResolvedValueOnce({ ok: true, status: 200, result: makeRecord('v1') })
      .mockResolvedValueOnce({ ok: true, status: 200, result: makeRecord('v2') })
    updateCrudMock.mockResolvedValue({ ok: true, status: 200, result: {} })

    renderWithProviders(<PromotionDetailPage params={{ id: 'promotion-1' }} />)

    await waitFor(() => {
      expect(crudFormPropsCapture.current?.initialValues?.updatedAt).toBe('v1')
    })
    const refreshSignalBeforeSubmit = ruleTreeBuilderPropsCapture.current?.refreshSignal

    await act(async () => {
      await crudFormPropsCapture.current!.onSubmit!({
        name: 'Spring sale', tags: [], excludedTags: [], eligibleCurrencies: [],
      })
    })

    expect(updateCrudMock).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(crudFormPropsCapture.current?.initialValues?.updatedAt).toBe('v2')
    })
    expect(apiCallMock).toHaveBeenCalledTimes(2)
    expect(ruleTreeBuilderPropsCapture.current?.refreshSignal).not.toBe(refreshSignalBeforeSubmit)
  })

  it('refreshes record.updatedAt after RuleTreeBuilder reports its own save via onSaved', async () => {
    apiCallMock
      .mockResolvedValueOnce({ ok: true, status: 200, result: makeRecord('v1') })
      .mockResolvedValueOnce({ ok: true, status: 200, result: makeRecord('v2') })

    renderWithProviders(<PromotionDetailPage params={{ id: 'promotion-1' }} />)

    await waitFor(() => {
      expect(crudFormPropsCapture.current?.initialValues?.updatedAt).toBe('v1')
    })

    act(() => {
      ruleTreeBuilderPropsCapture.current!.onSaved!()
    })

    await waitFor(() => {
      expect(crudFormPropsCapture.current?.initialValues?.updatedAt).toBe('v2')
    })
    expect(apiCallMock).toHaveBeenCalledTimes(2)
  })

  it('renders the promotion form once loaded', async () => {
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: makeRecord('v1') })

    renderWithProviders(<PromotionDetailPage params={{ id: 'promotion-1' }} />)

    await waitFor(() => {
      expect(screen.getByText('form')).toBeInTheDocument()
      expect(screen.getByText('tree')).toBeInTheDocument()
    })
  })
})
