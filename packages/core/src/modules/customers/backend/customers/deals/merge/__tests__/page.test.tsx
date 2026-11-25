/** @jest-environment jsdom */

import * as React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const mockTranslations: Record<string, string> = {
  'customers.deals.merge.errors.pipeline_stage': 'Pick a pipeline together with a stage',
}

const mockTranslate = (key: string, fallback?: unknown) => mockTranslations[key] ?? (typeof fallback === 'string' ? fallback : key)

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
  useOptionalLocale: () => 'en',
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush }),
  useSearchParams: () => ({
    get: (key: string) => (key === 'left' ? '11111111-1111-4111-8111-111111111111' : key === 'right' ? '22222222-2222-7222-8222-222222222222' : null),
  }),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: mockConfirm, ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResult(...args),
  apiCallOrThrow: (...args: unknown[]) => mockApiCallOrThrow(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/customFieldForms', () => ({
  fetchCustomFieldFormStructure: () => Promise.resolve({ fields: [] }),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: (...args: unknown[]) => mockSurfaceRecordConflict(...args),
}))

jest.mock('@open-mercato/ui/backend/forms', () => ({
  FormHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  FormFooter: ({ actions }: { actions: { submit: { formId: string; label: string } } }) => (
    <button type="submit" form={actions.submit.formId}>{actions.submit.label}</button>
  ),
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  ErrorMessage: ({ label, action }: { label: string; action?: React.ReactNode }) => <div role="alert">{label}{action}</div>,
  LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
}))

jest.mock('@open-mercato/ui/primitives/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
}))

jest.mock('@open-mercato/ui/primitives/segmented-control', () => {
  const ReactModule = jest.requireActual<typeof React>('react')
  const ChangeContext = ReactModule.createContext<(value: string) => void>(() => undefined)
  return {
    SegmentedControl: ({ children, onValueChange }: {
      children: React.ReactNode
      onValueChange: (value: string) => void
    }) => <ChangeContext.Provider value={onValueChange}><div>{children}</div></ChangeContext.Provider>,
    SegmentedControlItem: ({ children, value }: { children: React.ReactNode; value: string }) => {
      const onValueChange = ReactModule.useContext(ChangeContext)
      return <button type="button" onClick={() => onValueChange(value)}>{children}</button>
    },
  }
})

jest.mock('@open-mercato/ui/primitives/select', () => {
  const ReactModule = jest.requireActual<typeof React>('react')
  const findLabel = (children: React.ReactNode): string | undefined => {
    for (const child of ReactModule.Children.toArray(children)) {
      if (ReactModule.isValidElement<{ 'aria-label'?: string }>(child) && child.props['aria-label']) {
        return child.props['aria-label']
      }
    }
    return undefined
  }
  return {
    Select: ({ value, onValueChange, children }: {
      value?: string
      onValueChange: (value: string) => void
      children: React.ReactNode
    }) => (
      <select aria-label={findLabel(children)} value={value ?? ''} onChange={(event) => onValueChange(event.target.value)}>
        <option value="" />
        {children}
      </select>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
  }
})

jest.mock('@open-mercato/ui/primitives/date-picker', () => ({
  DatePicker: () => <input aria-label="date-picker" />,
}))

jest.mock('../../../../../components/formConfig', () => ({
  DictionarySelectField: ({ value, onChange }: { value?: string; onChange: (value: string | undefined) => void }) => (
    <select aria-label="status-select" value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
      <option value="" />
      <option value="open">Open</option>
      <option value="win">Won</option>
      <option value="lost">Lost</option>
    </select>
  ),
}))

jest.mock('../../../../../components/detail/DealOwnerSelect', () => ({
  DealOwnerSelect: ({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }) => (
    <input aria-label="owner-select" value={value ?? ''} onChange={(event) => onChange(event.target.value || null)} />
  ),
}))

jest.mock('../../../../../components/detail/create/DealCurrencyField', () => ({
  DealCurrencyField: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <input aria-label="currency-select" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}))

jest.mock('../../../../../components/detail/create/PipelineSelect', () => ({
  PipelineSelect: ({ value, onChange, pipelines }: {
    value?: string | null
    onChange: (value: string) => void
    pipelines: Array<{ id: string; name: string }>
  }) => (
    <select aria-label="pipeline-select" value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
      <option value="" />
      {pipelines.map((pipeline) => <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>)}
    </select>
  ),
}))

jest.mock('../components/useDealMergeLookups', () => ({
  useDealMergeLookups: () => ({
    pipelines: [{ id: 'pipeline-sales', name: 'Sales', isDefault: true }, { id: 'pipeline-renewals', name: 'Renewals', isDefault: false }],
    stages: [{ id: 'stage-negotiation', label: 'Negotiation', order: 1 }],
    stagesPipelineId: 'pipeline-renewals',
    stagesLoading: false,
    loadStages: mockLoadStages,
    lossReasons: [{ id: 'reason-price', label: 'Price' }, { id: 'reason-timing', label: 'Timing' }],
    pipelineLabel: (id: string) => ({ 'pipeline-sales': 'Sales', 'pipeline-renewals': 'Renewals' } as Record<string, string>)[id] ?? null,
    statusLabel: (status: string) => ({ open: 'Open', lost: 'Lost', win: 'Won' } as Record<string, string>)[status] ?? null,
    stageLabel: (stage: string) => ({ sales_qualified_lead: 'Sales Qualified Lead', negotiations: 'Negotiations' } as Record<string, string>)[stage] ?? null,
    sourceLabel: (source: string) => ({ customer_referral: 'Customer referral', partner_referral: 'Partner referral' } as Record<string, string>)[source] ?? null,
    lossReasonLabel: (id: string) => ({ 'reason-price': 'Price', 'reason-timing': 'Timing' } as Record<string, string>)[id] ?? null,
  }),
}))

const mockRouterPush = jest.fn()
const mockConfirm = jest.fn()
const mockReadApiResult = jest.fn()
const mockApiCallOrThrow = jest.fn()
const mockSurfaceRecordConflict = jest.fn()
const mockLoadStages = jest.fn().mockResolvedValue(undefined)

import DealMergePage from '../page'
import { DealMergeForm, type DealMergePreview } from '../components/DealMergeForm'

const LEFT_ID = '11111111-1111-4111-8111-111111111111'
const RIGHT_ID = '22222222-2222-7222-8222-222222222222'

function buildPreview(overrides?: { rightTitle?: string }): DealMergePreview {
  return {
    left: {
      id: LEFT_ID,
      updatedAt: '2026-11-24T10:00:00.000Z',
      createdAt: '2026-10-01T09:00:00.000Z',
      fields: {
        title: 'Left',
        status: 'open',
        closureOutcome: null,
        lossReasonId: null,
        lossNotes: null,
        pipelineId: 'pipeline-sales',
        pipelineStageId: 'stage-qualification',
        pipelineStage: 'sales_qualified_lead',
        valueAmount: 10,
        valueCurrency: 'USD',
        ownerUserId: 'aaaaaaaa-0000-4000-8000-000000000001',
        source: 'web',
      },
      customFields: { cf_note: 'left note' },
      people: [{ id: 'person-left', label: 'Left person', subtitle: null, isPrimary: true }],
      companies: [{ id: 'company-left', label: 'Left company', subtitle: null }],
      stageTransitions: [],
      counts: { activities: 1, comments: 2, interactions: 3 },
    },
    right: {
      id: RIGHT_ID,
      updatedAt: '2026-11-24T11:00:00.000Z',
      fields: {
        title: overrides?.rightTitle ?? 'Right',
        status: 'lost',
        closureOutcome: 'lost',
        lossReasonId: 'reason-price',
        lossNotes: 'Too expensive',
        pipelineId: 'pipeline-sales',
        pipelineStageId: 'stage-closed',
        pipelineStage: 'negotiations',
        valueAmount: 20,
        valueCurrency: 'USD',
        ownerUserId: 'aaaaaaaa-0000-4000-8000-000000000002',
        source: 'web',
      },
      customFields: { cf_note: 'right note' },
      people: [{ id: 'person-right', label: 'Right person', subtitle: null, isPrimary: false }],
      companies: [{ id: 'company-right', label: 'Right company', subtitle: null }],
      stageTransitions: [],
      counts: { activities: 4, comments: 5, interactions: 6 },
    },
    participants: [{
      participantId: 'documents',
      label: 'documents.dealMerge.participantLabel',
      sourceCount: 2,
      survivorCount: 1,
      overlapCount: 1,
    }],
  }
}

const dealMeta = {
  [LEFT_ID]: { owner: { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Alice Owner' } },
  [RIGHT_ID]: { owner: { id: 'aaaaaaaa-0000-4000-8000-000000000002', name: 'Bob Owner' } },
}

function renderForm(props?: Partial<React.ComponentProps<typeof DealMergeForm>>) {
  const onSubmit = jest.fn().mockResolvedValue(undefined)
  const onCancel = jest.fn()
  render(
    <DealMergeForm
      preview={buildPreview()}
      customFieldDefinitions={[]}
      dealMeta={dealMeta}
      pending={false}
      submitError={null}
      onRefresh={jest.fn()}
      onCancel={onCancel}
      onSubmit={onSubmit}
      {...props}
    />,
  )
  return { onSubmit, onCancel }
}

function row(key: string): HTMLElement {
  const element = document.querySelector(`[data-merge-field="${key}"]`)
  if (!element) throw new Error(`[internal] missing merge row ${key}`)
  return element as HTMLElement
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('DealMergeForm', () => {
  it('submits the default survivor with unioned associations and both lock tokens', async () => {
    const { onSubmit } = renderForm()

    fireEvent.click(screen.getByRole('button', { name: 'Merge deals' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      survivorId: LEFT_ID,
      sourceId: RIGHT_ID,
      survivorUpdatedAt: '2026-11-24T10:00:00.000Z',
      sourceUpdatedAt: '2026-11-24T11:00:00.000Z',
      values: expect.objectContaining({
        title: 'Left',
        status: 'open',
        closureOutcome: null,
        lossReasonId: null,
        pipelineId: 'pipeline-sales',
        pipelineStageId: 'stage-qualification',
        valueAmount: 10,
      }),
      customFields: { cf_note: 'left note' },
      personIds: ['person-left', 'person-right'],
      companyIds: ['company-left', 'company-right'],
      primaryPersonEntityId: 'person-left',
    })))
  })

  it('renders human labels instead of identifiers', () => {
    renderForm()

    expect(within(row('ownerUserId')).getAllByText('Alice Owner').length).toBeGreaterThan(0)
    expect(within(row('ownerUserId')).getAllByText('Bob Owner').length).toBeGreaterThan(0)
    expect(row('ownerUserId').textContent).not.toContain('aaaaaaaa-0000')
    expect(within(row('group:pipeline')).getAllByText('Sales · Sales Qualified Lead').length).toBeGreaterThan(0)
    expect(within(row('group:pipeline')).getAllByText('Sales · Negotiations').length).toBeGreaterThan(0)
    expect(row('group:pipeline').textContent).not.toContain('sales_qualified_lead')
    expect(row('group:pipeline').textContent).not.toContain('pipeline-sales')
    expect(within(row('group:closure')).getByText('Lost · Price · Too expensive')).toBeTruthy()
    expect(document.querySelector('[data-merge-related="documents"]')?.textContent).toContain('documents.dealMerge.participantLabel')
    expect(screen.getAllByRole('link', { name: 'Open deal in a new tab' })).toHaveLength(2)
  })

  it('renders source dictionary labels instead of raw keys', () => {
    const preview = buildPreview()
    preview.left.fields.source = 'customer_referral'
    preview.right.fields.source = 'partner_referral'
    renderForm({ preview })

    expect(within(row('source')).getAllByText('Customer referral').length).toBeGreaterThan(0)
    expect(within(row('source')).getAllByText('Partner referral').length).toBeGreaterThan(0)
    expect(row('source').textContent).not.toContain('customer_referral')
    expect(row('source').textContent).not.toContain('partner_referral')
  })

  it('hides identical rows until "show only differences" is switched off', () => {
    renderForm()

    expect(document.querySelector('[data-merge-field="source"]')).toBeNull()
    expect(document.querySelector('[data-merge-field="valueCurrency"]')).toBeNull()
    expect(row('title').getAttribute('data-differs')).toBe('true')

    fireEvent.click(screen.getByRole('switch', { name: 'Show only differences' }))

    expect(row('source').getAttribute('data-differs')).toBe('false')
    expect(row('valueCurrency')).toBeTruthy()
  })

  it('uses the cancel callback for Escape outside overlays', () => {
    const { onCancel } = renderForm()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('ignores Escape coming from an open dialog, select or already handled event', () => {
    const { onCancel } = renderForm()
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const inner = document.createElement('button')
    dialog.appendChild(inner)
    document.body.appendChild(dialog)

    fireEvent.keyDown(inner, { key: 'Escape' })
    dialog.remove()

    const listbox = document.createElement('div')
    listbox.setAttribute('role', 'listbox')
    document.body.appendChild(listbox)
    fireEvent.keyDown(window, { key: 'Escape' })
    listbox.remove()

    const handled = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    handled.preventDefault()
    act(() => {
      window.dispatchEvent(handled)
    })

    expect(onCancel).not.toHaveBeenCalled()
  })

  it('blocks Escape and Cmd+Enter while the confirm dialog is open', () => {
    const { onCancel, onSubmit } = renderForm({ shortcutsBlocked: true })

    fireEvent.keyDown(window, { key: 'Enter', metaKey: true })
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onSubmit).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('submits a custom pipeline and a stage of that pipeline', async () => {
    const { onSubmit } = renderForm()
    const pipelineRow = row('group:pipeline')

    fireEvent.click(within(pipelineRow).getByRole('button', { name: 'New value' }))
    fireEvent.change(within(pipelineRow).getByLabelText('pipeline-select'), { target: { value: 'pipeline-renewals' } })
    expect(mockLoadStages).toHaveBeenCalledWith('pipeline-renewals')
    fireEvent.change(within(pipelineRow).getByLabelText('Pipeline stage'), { target: { value: 'stage-negotiation' } })
    fireEvent.click(screen.getByRole('button', { name: 'Merge deals' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      values: expect.objectContaining({
        pipelineId: 'pipeline-renewals',
        pipelineStageId: 'stage-negotiation',
        pipelineStage: 'Negotiation',
      }),
    })))
  })

  it('requires a stage when a custom pipeline is chosen', async () => {
    const { onSubmit } = renderForm()
    const pipelineRow = row('group:pipeline')

    fireEvent.click(within(pipelineRow).getByRole('button', { name: 'New value' }))
    fireEvent.change(within(pipelineRow).getByLabelText('pipeline-select'), { target: { value: 'pipeline-renewals' } })
    fireEvent.click(screen.getByRole('button', { name: 'Merge deals' }))

    await waitFor(() => expect(within(row('group:pipeline')).getByText('Pick a pipeline together with a stage')).toBeTruthy())
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits a custom lost status with loss details and derives the closure outcome', async () => {
    const { onSubmit } = renderForm()
    const closureRow = row('group:closure')

    fireEvent.click(within(closureRow).getByRole('button', { name: 'New value' }))
    fireEvent.change(within(closureRow).getByLabelText('status-select'), { target: { value: 'lost' } })
    fireEvent.change(within(closureRow).getByLabelText('Loss reason'), { target: { value: 'reason-timing' } })
    fireEvent.change(within(closureRow).getByLabelText('Loss notes'), { target: { value: 'Budget frozen' } })
    fireEvent.click(screen.getByRole('button', { name: 'Merge deals' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      values: expect.objectContaining({
        status: 'lost',
        closureOutcome: 'lost',
        lossReasonId: 'reason-timing',
        lossNotes: 'Budget frozen',
      }),
    })))
  })

  it('hides loss details and clears them for a non-lost custom status', async () => {
    const base = buildPreview()
    const { onSubmit } = renderForm({
      preview: {
        ...base,
        left: { ...base.left, fields: { ...base.left.fields, status: 'lost', closureOutcome: 'lost', lossReasonId: 'reason-timing' } },
      },
    })
    const closureRow = row('group:closure')

    fireEvent.click(within(closureRow).getByRole('button', { name: 'New value' }))
    expect(within(closureRow).queryByLabelText('Loss reason')).toBeTruthy()
    fireEvent.change(within(closureRow).getByLabelText('status-select'), { target: { value: 'win' } })
    expect(within(closureRow).queryByLabelText('Loss reason')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Merge deals' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      values: expect.objectContaining({ status: 'win', closureOutcome: 'won', lossReasonId: null, lossNotes: null }),
    })))
  })

  it('uses the typed Deal custom-field control for a new numeric value', async () => {
    const preview = buildPreview()
    const numericPreview: DealMergePreview = {
      ...preview,
      left: { ...preview.left, customFields: { cf_score: 1 } },
      right: { ...preview.right, customFields: { cf_score: 2 } },
    }
    const { onSubmit } = renderForm({
      preview: numericPreview,
      customFieldDefinitions: [{ id: 'cf_score', label: 'Score', type: 'number' }],
    })

    const scoreRow = row('custom:cf_score')
    fireEvent.click(within(scoreRow).getByRole('button', { name: 'New value' }))
    fireEvent.change(within(scoreRow).getByRole('spinbutton', { name: 'Score' }), {
      target: { value: '42' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Merge deals' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      customFields: { cf_score: 42 },
    })))
  })

  it('keeps field choices when the preview is refreshed and drops only resolved differences', () => {
    const props = {
      customFieldDefinitions: [],
      dealMeta,
      pending: false,
      submitError: null,
      onRefresh: jest.fn(),
      onCancel: jest.fn(),
      onSubmit: jest.fn(),
    }
    const { rerender } = render(<DealMergeForm preview={buildPreview()} {...props} />)
    fireEvent.click(within(row('title')).getByRole('button', { name: 'Right' }))
    fireEvent.click(within(row('valueAmount')).getByRole('button', { name: 'Right' }))

    const refreshed = buildPreview({ rightTitle: 'Right renamed' })
    refreshed.right.fields.valueAmount = 10
    rerender(<DealMergeForm preview={refreshed} {...props} />)

    expect(row('title').getAttribute('data-choice')).toBe('right')
    expect(within(row('title')).getAllByText('Right renamed').length).toBeGreaterThan(0)
    expect(document.querySelector('[data-merge-field="valueAmount"]')).toBeNull()
  })
})

describe('DealMergePage', () => {
  function mockPreviewResponses(previews: DealMergePreview[]) {
    let previewCall = 0
    mockReadApiResult.mockImplementation((url: string) => {
      if (url.startsWith('/api/customers/deals/merge')) {
        const preview = previews[Math.min(previewCall, previews.length - 1)]
        previewCall += 1
        return Promise.resolve(preview)
      }
      if (url === `/api/customers/deals/${LEFT_ID}`) {
        return Promise.resolve({ deal: { createdAt: '2026-10-01T09:00:00.000Z' }, owner: { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Alice Owner' } })
      }
      return Promise.reject(new Error('not found'))
    })
  }

  it('accepts UUIDv7 ids and routes a 409 through the conflict surface while keeping choices after refresh', async () => {
    mockPreviewResponses([buildPreview(), buildPreview({ rightTitle: 'Right updated' })])
    mockConfirm.mockResolvedValue(true)
    mockApiCallOrThrow.mockRejectedValue(Object.assign(new Error('record_modified'), {
      status: 409,
      code: 'optimistic_lock_conflict',
      currentUpdatedAt: '2026-11-24T12:00:00.000Z',
      expectedUpdatedAt: '2026-11-24T11:00:00.000Z',
    }))
    mockSurfaceRecordConflict.mockReturnValue(true)

    render(<DealMergePage />)
    await waitFor(() => expect(document.querySelector('[data-merge-field="title"]')).not.toBeNull())
    fireEvent.click(within(row('title')).getByRole('button', { name: 'Right' }))
    fireEvent.click(screen.getByRole('button', { name: 'Merge deals' }))

    await waitFor(() => expect(mockSurfaceRecordConflict).toHaveBeenCalledTimes(1))
    const [, , options] = mockSurfaceRecordConflict.mock.calls[0] as [unknown, unknown, { onRefresh: () => void }]
    await act(async () => {
      options.onRefresh()
    })

    await waitFor(() => expect(within(row('title')).getAllByText('Right updated').length).toBeGreaterThan(0))
    expect(row('title').getAttribute('data-choice')).toBe('right')
    expect(mockRouterPush).not.toHaveBeenCalled()
  })

  it('shows translated server validation messages', async () => {
    mockPreviewResponses([buildPreview()])
    mockConfirm.mockResolvedValue(true)
    mockApiCallOrThrow.mockRejectedValue(Object.assign(new Error('Validation failed'), {
      status: 400,
      error: 'customers.deals.merge.errors.validation_failed',
      details: [{ message: 'customers.deals.merge.errors.pipeline_stage', path: ['values', 'pipelineStageId'] }],
    }))
    mockSurfaceRecordConflict.mockReturnValue(false)

    render(<DealMergePage />)
    await waitFor(() => expect(document.querySelector('[data-merge-field="title"]')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Merge deals' }))

    await waitFor(() => expect(screen.getByText('Pick a pipeline together with a stage')).toBeTruthy())
  })

  it('does not submit again with Cmd+Enter while the confirmation is open', async () => {
    mockPreviewResponses([buildPreview()])
    let resolveConfirm: (value: boolean) => void = () => undefined
    mockConfirm.mockImplementation(() => new Promise<boolean>((resolve) => {
      resolveConfirm = resolve
    }))

    render(<DealMergePage />)
    await waitFor(() => expect(document.querySelector('[data-merge-field="title"]')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Merge deals' }))
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1))

    fireEvent.keyDown(window, { key: 'Enter', metaKey: true })
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(mockConfirm).toHaveBeenCalledTimes(1)
    expect(mockRouterPush).not.toHaveBeenCalled()
    await act(async () => {
      resolveConfirm(false)
    })
  })
})
