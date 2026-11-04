/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { DealDetailsFields } from '../DealDetailsFields'
import { EMPTY_VALUES } from '../dealFormTypes'

jest.mock('../../hooks/useCurrencyDictionary', () => ({
  useCurrencyDictionary: () => ({
    data: { entries: [{ value: 'USD', label: 'US Dollar' }] },
    error: null,
    isLoading: false,
    refetch: jest.fn(),
  }),
}))

jest.mock('../../DealOwnerSelect', () => ({ DealOwnerSelect: () => null }))

const translate = (_key: string, fallback: string) => fallback

function renderFields() {
  return renderWithProviders(
    <DealDetailsFields
      values={{ ...EMPTY_VALUES, valueAmount: '250', valueCurrency: 'USD' }}
      errors={{}}
      isSubmitting={false}
      patch={jest.fn()}
      onPipelineChange={jest.fn()}
      pipelines={[]}
      stages={[]}
      tr={translate}
    />,
  )
}

describe('DealDetailsFields', () => {
  it('shows a retry instead of the stage picker when the stages failed to load', async () => {
    const onRetryStages = jest.fn()
    renderWithProviders(
      <DealDetailsFields
        values={{ ...EMPTY_VALUES, pipelineId: 'pipe-1', pipelineStageId: 'stage-1' }}
        errors={{}}
        isSubmitting={false}
        patch={jest.fn()}
        onPipelineChange={jest.fn()}
        pipelines={[]}
        stages={[]}
        stagesFailed
        onRetryStages={onRetryStages}
        tr={translate}
      />,
    )

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Could not load the stages of this pipeline.')
    within(alert).getByRole('button', { name: 'Try again' }).click()
    expect(onRetryStages).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Currency' })).toBeInTheDocument())
  })

  it('names the amount input through the Deal value label', async () => {
    renderFields()
    const amount = screen.getByLabelText('Deal value')
    expect(amount.tagName).toBe('INPUT')
    expect(amount).toHaveValue('250')
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Currency' })).toBeInTheDocument())
  })

  it('gives the currency select its own accessible name', async () => {
    renderFields()
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveTextContent('USD'))
  })
})
