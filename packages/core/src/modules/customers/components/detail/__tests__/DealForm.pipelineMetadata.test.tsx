/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { waitFor } from '@testing-library/react'

const crudFormMock = jest.fn((_props: Record<string, unknown>) => null)
const apiCallMock = jest.fn()
const readApiResultOrThrowMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: Record<string, unknown>) => crudFormMock(props),
}))

import { DealForm, resetDealPipelineMetadataCacheForTests } from '../DealForm'

describe('DealForm pipeline metadata loading', () => {
  beforeEach(() => {
    resetDealPipelineMetadataCacheForTests()
    crudFormMock.mockClear()
    apiCallMock.mockReset()
    readApiResultOrThrowMock.mockReset()
    readApiResultOrThrowMock.mockResolvedValue({ id: 'currency', entries: [] })
    apiCallMock.mockResolvedValue({
      ok: true,
      result: {
        items: [
          { id: 'pipeline-1', name: 'Enterprise pipeline', isDefault: true },
        ],
      },
    })
  })

  it('dedupes concurrent pipeline loads and skips stage fetch when stages are seeded', async () => {
    const renderForm = (key: string) => (
      <DealForm
        key={key}
        mode="edit"
        initialValues={{
          title: 'Expansion renewal',
          pipelineId: 'pipeline-1',
          pipelineStageId: 'stage-1',
        }}
        initialPipelineOptions={[
          { id: 'pipeline-1', name: 'Enterprise pipeline', isDefault: false },
        ]}
        initialPipelineStageOptions={[
          { id: 'stage-1', label: 'Discovery', order: 1 },
        ]}
        onSubmit={async () => {}}
        onCancel={() => {}}
      />
    )

    renderWithProviders(
      <React.StrictMode>
        {renderForm('one')}
        {renderForm('two')}
      </React.StrictMode>,
    )

    await waitFor(() => {
      expect(apiCallMock).toHaveBeenCalledTimes(1)
    })
    expect(apiCallMock).toHaveBeenCalledWith('/api/customers/pipelines')
    expect(apiCallMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/customers/pipeline-stages'))
  })
})


it('hydrates deal namespaces with explicit form identity while native submits remain whitelisted', async () => {
  apiCallMock.mockResolvedValue({ ok: true, result: { items: [] } })
  readApiResultOrThrowMock.mockResolvedValue({ id: 'currency', entries: [] })
  crudFormMock.mockClear()
  const onSubmit = jest.fn(async () => {})
  const namespace = { priority: 'high', priorityId: 'priority-1' }
  renderWithProviders(<DealForm mode="edit" showVersionHistory={false} initialValues={{ id: 'deal-1', title: 'Deal', _example: namespace }} onSubmit={onSubmit} onCancel={() => {}} />)
  await waitFor(() => expect(crudFormMock).toHaveBeenCalled())
  const props = crudFormMock.mock.calls[0][0]
  expect(props).toMatchObject({ entityId: 'customers.deal', resourceKind: 'customers.deal', resourceId: 'deal-1', initialValues: { _example: namespace } })
  const submit = props.onSubmit as (values: Record<string, unknown>) => Promise<void>
  await submit({ ...(props.initialValues as Record<string, unknown>), '_example.priority': 'critical', cf_tier: 'a' })
  expect(onSubmit).toHaveBeenCalledWith({ base: expect.objectContaining({ title: 'Deal' }), custom: { tier: 'a' } })
  expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('_example')
  expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('base._example')
})
