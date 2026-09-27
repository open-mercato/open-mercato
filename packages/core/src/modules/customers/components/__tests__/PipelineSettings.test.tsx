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


  it('identifies every stage action by the stage label', async () => {
    readApiResultOrThrowMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/customers/pipeline-stages')) {
        return {
          items: [
            { id: 'stage-1', pipelineId: 'pipeline-1', label: 'Qualified', order: 10 },
            { id: 'stage-2', pipelineId: 'pipeline-1', label: 'Won', order: 20 },
          ],
        }
      }
      return { items: [{ id: 'pipeline-1', name: 'Sales Pipeline', isDefault: true }] }
    })

    renderWithProviders(<PipelineSettings />)

    const pipelineLabel = await screen.findByText('Sales Pipeline')
    fireEvent.click(pipelineLabel.closest('button') as HTMLButtonElement)

    expect(await screen.findByRole('button', { name: 'Move up — Qualified' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move down — Won' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit — Qualified' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete — Won' })).toBeInTheDocument()
  })
})
