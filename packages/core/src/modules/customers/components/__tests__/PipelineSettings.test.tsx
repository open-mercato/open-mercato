/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import PipelineSettings from '../PipelineSettings'

const apiCallMock = jest.fn()
const readApiResultOrThrowMock = jest.fn()
const runMutationMock = jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => operation())

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
  withScopedApiRequestHeaders: (_headers: unknown, fn: () => Promise<unknown>) => fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  raiseCrudError: jest.fn(async () => {
    throw new Error('[internal] crud error')
  }),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: (...args: unknown[]) => runMutationMock(...(args as [{ operation: () => Promise<unknown> }])),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 0,
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: jest.fn().mockResolvedValue(true),
    ConfirmDialogElement: null,
  }),
}))

jest.mock('@open-mercato/core/modules/dictionaries/components/AppearanceSelector', () => ({
  AppearanceSelector: () => null,
}))

jest.mock('@open-mercato/core/modules/dictionaries/components/dictionaryAppearance', () => ({
  renderDictionaryColor: () => null,
  renderDictionaryIcon: () => null,
}))

describe('PipelineSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    readApiResultOrThrowMock.mockResolvedValue({ items: [] })
    apiCallMock.mockResolvedValue({ ok: true, result: {}, response: { ok: true } })
  })

  it('routes a pipeline create through the guarded mutation runner', async () => {
    renderWithProviders(<PipelineSettings />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add pipeline' }))

    const nameInput = await screen.findByPlaceholderText('e.g. New Business')
    fireEvent.change(nameInput, { target: { value: 'New Business' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(runMutationMock).toHaveBeenCalledTimes(1)
    })
    expect(runMutationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          resourceKind: 'customers.pipeline',
          retryLastMutation: expect.any(Function),
        }),
        mutationPayload: expect.objectContaining({ action: 'create', name: 'New Business' }),
      }),
    )
    expect(apiCallMock).toHaveBeenCalledWith(
      '/api/customers/pipelines',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('sends the stage probabilities flag when creating a pipeline', async () => {
    renderWithProviders(<PipelineSettings />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add pipeline' }))
    fireEvent.change(await screen.findByPlaceholderText('e.g. New Business'), { target: { value: 'Weighted' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Use default stage probabilities' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
    const [, init] = apiCallMock.mock.calls[0] as [string, { body: string }]
    expect(JSON.parse(init.body)).toEqual({ name: 'Weighted', isDefault: false, stageProbabilitiesEnabled: true })
  })

  function mockPipelineWithStages(stageProbabilitiesEnabled: boolean) {
    readApiResultOrThrowMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/customers/pipeline-stages')) {
        return {
          items: [{ id: 'stage-1', pipelineId: 'pipeline-1', label: 'Negotiation', order: 0, defaultProbability: 60 }],
        }
      }
      return { items: [{ id: 'pipeline-1', name: 'Sales', isDefault: true, stageProbabilitiesEnabled }] }
    })
  }

  it('shows stage defaults and sends defaultProbability when the pipeline opted in', async () => {
    mockPipelineWithStages(true)
    renderWithProviders(<PipelineSettings />)

    fireEvent.click(await screen.findByText('Sales'))
    expect(await screen.findByText('60%')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add stage' }))
    fireEvent.change(await screen.findByPlaceholderText('e.g. Discovery'), { target: { value: 'Proposal' } })
    fireEvent.change(screen.getByLabelText('Default probability (%)'), { target: { value: '40' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
    const [url, init] = apiCallMock.mock.calls[0] as [string, { body: string }]
    expect(url).toBe('/api/customers/pipeline-stages')
    expect(JSON.parse(init.body)).toEqual({ pipelineId: 'pipeline-1', label: 'Proposal', defaultProbability: 40 })
  })

  it('hides stage defaults when the pipeline did not opt in', async () => {
    mockPipelineWithStages(false)
    renderWithProviders(<PipelineSettings />)

    fireEvent.click(await screen.findByText('Sales'))
    expect(await screen.findByText('Negotiation')).toBeInTheDocument()
    expect(screen.queryByText('60%')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add stage' }))
    await screen.findByPlaceholderText('e.g. Discovery')
    expect(screen.queryByLabelText('Default probability (%)')).not.toBeInTheDocument()
  })
})
