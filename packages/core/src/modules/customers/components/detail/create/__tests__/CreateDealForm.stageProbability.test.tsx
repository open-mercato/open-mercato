/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { z } from 'zod'
import { CreateDealForm } from '../CreateDealForm'

type StageItem = { id: string; label: string; order: number; defaultProbability: number | null }

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
  useOptionalLocale: () => 'en',
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
      probability: z.preprocess(
        (value) => (value === '' || value === undefined || value === null ? undefined : Number(value)),
        z.number().optional(),
      ),
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
      onPipelineChange,
    }: {
      values: { title: string; pipelineId: string; pipelineStageId: string }
      stages: Array<{ id: string; label: string }>
      patch: (partial: Partial<{ title: string; pipelineStageId: string }>) => void
      onPipelineChange: (pipelineId: string) => void
    }) =>
      ReactForMock.createElement(
        'div',
        null,
        ReactForMock.createElement('input', {
          'aria-label': 'Deal title',
          value: values.title,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => patch({ title: event.target.value }),
        }),
        ReactForMock.createElement('output', { 'aria-label': 'Stage' }, values.pipelineStageId),
        ...['pipe-a', 'pipe-b', 'pipe-off'].map((pipelineId) =>
          ReactForMock.createElement('button', {
            key: pipelineId,
            type: 'button',
            onClick: () => onPipelineChange(pipelineId),
          }, `Pipeline ${pipelineId}`),
        ),
        ...stages.map((stage) =>
          ReactForMock.createElement('button', {
            key: stage.id,
            type: 'button',
            onClick: () => patch({ pipelineStageId: stage.id }),
          }, `Stage ${stage.label}`),
        ),
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

const STAGES: Record<string, StageItem[]> = {
  'pipe-a': [
    { id: 'a-qualify', label: 'A qualify', order: 0, defaultProbability: 10 },
    { id: 'a-negotiate', label: 'A negotiate', order: 1, defaultProbability: 60 },
    { id: 'a-review', label: 'A review', order: 2, defaultProbability: null },
  ],
  'pipe-b': [
    { id: 'b-open', label: 'B open', order: 0, defaultProbability: 20 },
  ],
  'pipe-off': [
    { id: 'off-open', label: 'Off open', order: 0, defaultProbability: 90 },
  ],
}

function probabilityInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('[data-crud-field-id="probability"] input')
  if (!input) throw new Error('[internal] probability input not rendered')
  return input
}

async function waitForStage(stageId: string) {
  await waitFor(() => expect(screen.getByLabelText('Stage')).toHaveTextContent(stageId))
}

async function submitPayload(): Promise<Record<string, unknown>> {
  fireEvent.change(screen.getByLabelText('Deal title'), { target: { value: 'New deal' } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create deal' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Create deal' }))
  await waitFor(() => expect(mockCreateCrud).toHaveBeenCalledTimes(1))
  return mockCreateCrud.mock.calls[0][1] as Record<string, unknown>
}

describe('CreateDealForm stage default probability', () => {
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
              { id: 'pipe-a', name: 'A', isDefault: true, stageProbabilitiesEnabled: true },
              { id: 'pipe-b', name: 'B', isDefault: false, stageProbabilitiesEnabled: true },
              { id: 'pipe-off', name: 'Off', isDefault: false, stageProbabilitiesEnabled: false },
            ],
          },
        })
      }
      const pipelineId = Object.keys(STAGES).find((id) => url.includes(`pipelineId=${id}`))
      if (pipelineId) return Promise.resolve({ ok: true, result: { items: STAGES[pipelineId] } })
      return Promise.resolve({ ok: false, result: null })
    })
  })

  it('prefills the default of the first stage the form selects on its own', async () => {
    render(<CreateDealForm returnTo="/backend/customers/deals" />)
    await waitForStage('a-qualify')
    await waitFor(() => expect(probabilityInput()).toHaveValue('10'))
  })

  it('replaces a prefilled default when a pipeline switch selects a stage with another default', async () => {
    render(<CreateDealForm returnTo="/backend/customers/deals" />)
    await waitForStage('a-qualify')
    fireEvent.click(screen.getByRole('button', { name: 'Stage A negotiate' }))
    await waitFor(() => expect(probabilityInput()).toHaveValue('60'))

    fireEvent.click(screen.getByRole('button', { name: 'Pipeline pipe-b' }))
    await waitForStage('b-open')
    await waitFor(() => expect(probabilityInput()).toHaveValue('20'))

    expect(await submitPayload()).toEqual(
      expect.objectContaining({ pipelineId: 'pipe-b', pipelineStageId: 'b-open', probability: 20 }),
    )
  })

  it('keeps a probability the user typed across stage and pipeline changes', async () => {
    render(<CreateDealForm returnTo="/backend/customers/deals" />)
    await waitForStage('a-qualify')
    fireEvent.click(screen.getByRole('button', { name: 'Stage A negotiate' }))
    await waitFor(() => expect(probabilityInput()).toHaveValue('60'))
    fireEvent.change(probabilityInput(), { target: { value: '42' } })

    fireEvent.click(screen.getByRole('button', { name: 'Pipeline pipe-b' }))
    await waitForStage('b-open')
    expect(probabilityInput()).toHaveValue('42')

    expect(await submitPayload()).toEqual(expect.objectContaining({ pipelineStageId: 'b-open', probability: 42 }))
  })

  it('clears a prefilled default when the next stage has none or the pipeline is opted out', async () => {
    render(<CreateDealForm returnTo="/backend/customers/deals" />)
    await waitForStage('a-qualify')
    fireEvent.click(screen.getByRole('button', { name: 'Stage A review' }))
    await waitFor(() => expect(probabilityInput()).toHaveValue(''))

    fireEvent.click(screen.getByRole('button', { name: 'Stage A negotiate' }))
    await waitFor(() => expect(probabilityInput()).toHaveValue('60'))
    fireEvent.click(screen.getByRole('button', { name: 'Pipeline pipe-off' }))
    await waitForStage('off-open')
    await waitFor(() => expect(probabilityInput()).toHaveValue(''))

    const payload = await submitPayload()
    expect(payload).toEqual(expect.objectContaining({ pipelineId: 'pipe-off', pipelineStageId: 'off-open' }))
    expect(payload.probability).toBeUndefined()
  })

  it('keeps a seeded probability', async () => {
    render(<CreateDealForm returnTo="/backend/customers/deals" initialValues={{ probability: '15' }} />)
    await waitForStage('a-qualify')
    fireEvent.click(screen.getByRole('button', { name: 'Stage A negotiate' }))
    await waitForStage('a-negotiate')
    expect(probabilityInput()).toHaveValue('15')
  })
})
