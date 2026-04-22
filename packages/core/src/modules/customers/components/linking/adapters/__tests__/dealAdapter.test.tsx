/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { createDealLinkAdapter } from '../dealAdapter'

const readApiResultOrThrowMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

describe('createDealLinkAdapter', () => {
  beforeEach(() => {
    readApiResultOrThrowMock.mockReset()
  })

  it('maps nested deal details and association labels into the preview card', async () => {
    readApiResultOrThrowMock.mockResolvedValueOnce({
      deal: {
        id: 'deal-1',
        title: 'Expansion Renewal',
        code: 'DL-42',
        pipelineStage: 'Qualified',
        valueAmount: '12500',
        valueCurrency: 'USD',
        createdAt: '2026-04-01T08:30:00.000Z',
      },
      people: [
        { id: 'person-1', label: 'Alice Baker', subtitle: 'CTO' },
        { id: 'person-2', label: 'Mark Chen', subtitle: 'Procurement' },
      ],
      companies: [{ id: 'company-1', label: 'Acme Inc', subtitle: 'acme.test' }],
    })

    const adapter = createDealLinkAdapter({
      dialogTitle: 'Link deal',
      searchPlaceholder: 'Search deals',
      searchEmptyHint: 'No deals',
      selectedEmptyHint: 'No selection',
      confirmButtonLabel: 'Link deal',
      orphanWarningTitle: 'Deal without company',
      orphanWarningMessage: 'This deal has no other linked entities.',
    })

    expect(adapter.fetchDetails).toBeDefined()
    expect(adapter.renderPreview).toBeDefined()

    const details = await adapter.fetchDetails!('deal-1')

    expect(readApiResultOrThrowMock).toHaveBeenCalledWith('/api/customers/deals/deal-1')
    expect(details).toMatchObject({
      id: 'deal-1',
      title: 'Expansion Renewal',
      code: 'DL-42',
      stage: 'Qualified',
      value: { amount: '12500', currency: 'USD' },
      anchors: { companies: 1, people: 2 },
      keyPeople: [
        { id: 'person-1', name: 'Alice Baker', role: 'CTO' },
        { id: 'person-2', name: 'Mark Chen', role: 'Procurement' },
      ],
    })

    render(
      <>
        {adapter.renderPreview!(
          {
            id: 'deal-1',
            label: 'Fallback deal label',
            subtitle: null,
          },
          details,
        )}
      </>,
    )

    expect(screen.getByText('Expansion Renewal')).toBeInTheDocument()
    expect(screen.getByText('DL-42')).toBeInTheDocument()
    expect(screen.getByText('Qualified')).toBeInTheDocument()
    expect(screen.getByText('Alice Baker')).toBeInTheDocument()
    expect(screen.getByText('Mark Chen')).toBeInTheDocument()
    expect(screen.getByText('CTO')).toBeInTheDocument()
    expect(screen.queryByText('Fallback deal label')).not.toBeInTheDocument()
  })
})
