/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { waitFor } from '@testing-library/react'

const apiCallMock = jest.fn()
const readApiResultOrThrowMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: () => null,
}))

import { DealForm, resetDealPipelineMetadataCacheForTests } from '../DealForm'

describe('DealForm pipeline metadata loading', () => {
  beforeEach(() => {
    resetDealPipelineMetadataCacheForTests()
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
