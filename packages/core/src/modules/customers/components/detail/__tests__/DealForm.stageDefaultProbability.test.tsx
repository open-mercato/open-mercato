/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { act, waitFor } from '@testing-library/react'

type CapturedField = {
  id: string
  component?: (props: Record<string, unknown>) => React.ReactElement<{ onValueChange: (next: string) => void }>
}

const apiCallMock = jest.fn()
const readApiResultOrThrowMock = jest.fn()
const crudFormMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: unknown) => {
    crudFormMock(props)
    return null
  },
}))

import { DealForm, resetDealPipelineMetadataCacheForTests } from '../DealForm'

const PIPELINE_ID = 'pipeline-1'
const CURRENT_STAGE_ID = 'stage-1'
const TARGET_STAGE_ID = 'stage-2'

function renderDealForm(stageProbabilitiesEnabled: boolean) {
  return renderWithProviders(
    <DealForm
      mode="edit"
      initialValues={{
        title: 'Expansion renewal',
        pipelineId: PIPELINE_ID,
        pipelineStageId: CURRENT_STAGE_ID,
        probability: 5,
      }}
      initialPipelineOptions={[
        { id: PIPELINE_ID, name: 'Enterprise pipeline', isDefault: false, stageProbabilitiesEnabled },
      ]}
      initialPipelineStageOptions={[
        { id: CURRENT_STAGE_ID, label: 'Discovery', order: 1, defaultProbability: 5 },
        { id: TARGET_STAGE_ID, label: 'Proposal', order: 2, defaultProbability: 60 },
      ]}
      onSubmit={async () => {}}
      onCancel={() => {}}
    />,
  )
}

function changeStage(setFormValue: jest.Mock) {
  const lastProps = crudFormMock.mock.calls[crudFormMock.mock.calls.length - 1][0] as { fields: CapturedField[] }
  const stageField = lastProps.fields.find((field) => field.id === 'pipelineStageId')
  const element = stageField!.component!({
    value: CURRENT_STAGE_ID,
    values: { pipelineId: PIPELINE_ID, pipelineStageId: CURRENT_STAGE_ID, probability: 5 },
    setValue: jest.fn(),
    setFormValue,
  })
  act(() => {
    element.props.onValueChange(TARGET_STAGE_ID)
  })
}

function probabilityWrites(setFormValue: jest.Mock) {
  return setFormValue.mock.calls.filter(([fieldId]) => fieldId === 'probability')
}

describe('DealForm stage default probability with seeded pipeline metadata', () => {
  beforeEach(() => {
    resetDealPipelineMetadataCacheForTests()
    apiCallMock.mockReset()
    readApiResultOrThrowMock.mockReset()
    crudFormMock.mockReset()
    readApiResultOrThrowMock.mockResolvedValue({ id: 'currency', entries: [] })
  })

  it('applies the target stage default while the pipelines request is still pending', async () => {
    apiCallMock.mockReturnValue(new Promise(() => {}))
    renderDealForm(true)
    await waitFor(() => expect(crudFormMock).toHaveBeenCalled())

    const setFormValue = jest.fn()
    changeStage(setFormValue)

    expect(probabilityWrites(setFormValue)).toEqual([['probability', 60]])
  })

  it('applies the target stage default when the pipelines request is forbidden', async () => {
    apiCallMock.mockResolvedValue({ ok: false, status: 403, result: { error: 'Forbidden' } })
    renderDealForm(true)
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledWith('/api/customers/pipelines'))
    await act(async () => {})

    const setFormValue = jest.fn()
    changeStage(setFormValue)

    expect(probabilityWrites(setFormValue)).toEqual([['probability', 60]])
  })

  it('does not overwrite a manual edit when delayed pipeline metadata arrives', async () => {
    let resolvePipelines: (value: unknown) => void = () => {}
    apiCallMock.mockReturnValue(new Promise((resolve) => {
      resolvePipelines = resolve
    }))
    renderDealForm(true)
    await waitFor(() => expect(crudFormMock).toHaveBeenCalled())

    const setFormValue = jest.fn()
    changeStage(setFormValue)
    const renderCountBeforeMetadata = crudFormMock.mock.calls.length

    await act(async () => {
      resolvePipelines({
        ok: true,
        result: { items: [{ id: PIPELINE_ID, name: 'Enterprise pipeline', isDefault: false, stageProbabilitiesEnabled: true }] },
      })
    })

    expect(crudFormMock.mock.calls.length).toBeGreaterThan(renderCountBeforeMetadata)
    expect(probabilityWrites(setFormValue)).toEqual([['probability', 60]])
  })

  it('keeps the probability when the seeded pipeline has stage defaults disabled', async () => {
    apiCallMock.mockReturnValue(new Promise(() => {}))
    renderDealForm(false)
    await waitFor(() => expect(crudFormMock).toHaveBeenCalled())

    const setFormValue = jest.fn()
    changeStage(setFormValue)

    expect(probabilityWrites(setFormValue)).toEqual([])
  })
})
