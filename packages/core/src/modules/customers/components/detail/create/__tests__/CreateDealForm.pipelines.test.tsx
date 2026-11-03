/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { z } from 'zod'
import { CreateDealForm } from '../CreateDealForm'

type StagesCall = { ok: boolean; result: { items: Array<{ id: string; label: string; order: number }> } }

const mockCreateCrud = jest.fn()
const mockApiCall = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/backend/customers/deals/create',
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('next/link', () => {
  const ReactForMock = require('react') as typeof React
  return {
    __esModule: true,
    default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
      ReactForMock.createElement('a', { href, ...props }, children),
  }
})

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallbackOrParams?: string | Record<string, string | number>) =>
    typeof fallbackOrParams === 'string' ? fallbackOrParams : key,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: (...args: unknown[]) => mockCreateCrud(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/utils/apiCall'),
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: ({ operation }: { operation: () => Promise<unknown> }) =>
      operation().then((result) => ({ result })),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/utils/useCurrentUserId', () => ({ useCurrentUserId: () => '' }))

jest.mock('../../DealForm', () => {
  const textField = z.preprocess((value) => (typeof value === 'string' ? value : ''), z.string())
  return {
    dealFormSchema: z.object({
      title: z.string().trim().min(1, 'customers.people.detail.deals.titleRequired'),
      status: textField,
      pipelineId: textField,
      pipelineStageId: textField,
      valueCurrency: textField,
      expectedCloseAt: textField,
      description: textField,
      ownerUserId: textField,
      personIds: z.array(z.string()).default([]),
      companyIds: z.array(z.string()).default([]),
    }),
  }
})

jest.mock('../../../formConfig', () => ({ DictionarySelectField: () => null }))

jest.mock('../DealDetailsFields', () => {
  const ReactForMock = require('react') as typeof React
  return {
    DealDetailsFields: ({
      values,
      stages,
      patch,
    }: {
      values: { title: string; pipelineId: string; pipelineStageId: string }
      stages: Array<{ id: string; label: string }>
      patch: (partial: Partial<{ title: string; pipelineId: string }>) => void
    }) =>
      ReactForMock.createElement(
        'div',
        null,
        ReactForMock.createElement('input', {
          'aria-label': 'Deal title',
          value: values.title,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => patch({ title: event.target.value }),
        }),
        ReactForMock.createElement('output', { 'aria-label': 'Pipeline' }, values.pipelineId),
        ReactForMock.createElement('output', { 'aria-label': 'Stage' }, values.pipelineStageId),
        ReactForMock.createElement('output', { 'aria-label': 'Offered stages' }, stages.map((stage) => stage.label).join(',')),
        ReactForMock.createElement('button', {
          type: 'button',
          onClick: () => patch({ pipelineId: 'pipe-other' }),
        }, 'Set pipeline without the select'),
      ),
  }
})

jest.mock('../DealAssociationsField', () => ({ DealAssociationsField: () => null }))

jest.mock('../DealCustomAttributes', () => {
  const ReactForMock = require('react') as typeof React
  return {
    DealCustomAttributes: ({
      onLoaded,
    }: {
      onLoaded?: (state: { fields: unknown[]; definitions: unknown[] }) => void
    }) => {
      ReactForMock.useEffect(() => {
        onLoaded?.({ fields: [], definitions: [] })
      }, [])
      return null
    },
  }
})

const DEFAULT_PIPELINE_STAGES: StagesCall = {
  ok: true,
  result: {
    items: [
      { id: 'default-second', label: 'Default second', order: 1 },
      { id: 'default-first', label: 'Default first', order: 0 },
    ],
  },
}
const OTHER_PIPELINE_STAGES: StagesCall = {
  ok: true,
  result: { items: [{ id: 'other-first', label: 'Other first', order: 0 }] },
}

let resolveOtherPipelineStages: (value: StagesCall) => void = () => {}

function submitDeal() {
  fireEvent.change(screen.getByLabelText('Deal title'), { target: { value: 'New deal' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create deal' }))
}

describe('CreateDealForm pipeline defaults', () => {
  beforeEach(() => {
    mockCreateCrud.mockReset()
    mockCreateCrud.mockResolvedValue({ result: { id: 'deal-1' } })
    mockApiCall.mockReset()
    mockApiCall.mockImplementation((url: string) => {
      if (url === '/api/customers/pipelines') {
        return Promise.resolve({
          ok: true,
          result: {
            items: [
              { id: 'pipe-other', name: 'Partners', isDefault: false },
              { id: 'pipe-default', name: 'Sales', isDefault: true },
            ],
          },
        })
      }
      if (url.includes('pipelineId=pipe-default')) return Promise.resolve(DEFAULT_PIPELINE_STAGES)
      if (url.includes('pipelineId=pipe-other')) {
        return new Promise<StagesCall>((resolve) => { resolveOtherPipelineStages = resolve })
      }
      return Promise.resolve({ ok: false, result: null })
    })
  })

  it('submits the default pipeline with its first stage', async () => {
    render(<CreateDealForm returnTo="/backend/customers/deals" />)

    await waitFor(() => expect(screen.getByLabelText('Stage')).toHaveTextContent('default-first'))
    expect(screen.getByLabelText('Pipeline')).toHaveTextContent('pipe-default')
    expect(screen.getByLabelText('Offered stages')).toHaveTextContent('Default first,Default second')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create deal' })).toBeEnabled())

    submitDeal()

    await waitFor(() => expect(mockCreateCrud).toHaveBeenCalledTimes(1))
    expect(mockCreateCrud.mock.calls[0][1]).toEqual(
      expect.objectContaining({ pipelineId: 'pipe-default', pipelineStageId: 'default-first' }),
    )
  })

  it('reloads stages and replaces the stale stage when pipelineId changes without the select', async () => {
    render(<CreateDealForm returnTo="/backend/customers/deals" />)
    await waitFor(() => expect(screen.getByLabelText('Stage')).toHaveTextContent('default-first'))

    fireEvent.click(screen.getByRole('button', { name: 'Set pipeline without the select' }))

    await waitFor(() => expect(mockApiCall).toHaveBeenCalledWith(expect.stringContaining('pipelineId=pipe-other')))
    expect(screen.getByLabelText('Pipeline')).toHaveTextContent('pipe-other')
    expect(screen.getByLabelText('Offered stages')).toBeEmptyDOMElement()
    expect(screen.getByLabelText('Stage')).toHaveTextContent('default-first')

    await act(async () => {
      resolveOtherPipelineStages(OTHER_PIPELINE_STAGES)
    })

    await waitFor(() => expect(screen.getByLabelText('Stage')).toHaveTextContent('other-first'))
    expect(screen.getByLabelText('Offered stages')).toHaveTextContent('Other first')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create deal' })).toBeEnabled())

    submitDeal()

    await waitFor(() => expect(mockCreateCrud).toHaveBeenCalledTimes(1))
    expect(mockCreateCrud.mock.calls[0][1]).toEqual(
      expect.objectContaining({ pipelineId: 'pipe-other', pipelineStageId: 'other-first' }),
    )
  })

  it('drops the previous stage when the new pipeline has no stages', async () => {
    render(<CreateDealForm returnTo="/backend/customers/deals" />)
    await waitFor(() => expect(screen.getByLabelText('Stage')).toHaveTextContent('default-first'))

    fireEvent.click(screen.getByRole('button', { name: 'Set pipeline without the select' }))
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledWith(expect.stringContaining('pipelineId=pipe-other')))
    await act(async () => {
      resolveOtherPipelineStages({ ok: true, result: { items: [] } })
    })

    await waitFor(() => expect(screen.getByLabelText('Stage')).toBeEmptyDOMElement())
  })
})
