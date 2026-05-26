/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { DealDetailHeader } from '../DealDetailHeader'

const mockSendObjectMessageDialog = jest.fn()

jest.mock('@open-mercato/ui/backend/messages', () => ({
  SendObjectMessageDialog: (props: Record<string, unknown>) => {
    mockSendObjectMessageDialog(props)
    return <button type="button">Send message</button>
  },
}))

jest.mock('../hooks/useCustomerDictionary', () => ({
  useCustomerDictionary: jest.fn(() => ({ data: { map: {} } })),
}))

describe('DealDetailHeader', () => {
  beforeEach(() => {
    mockSendObjectMessageDialog.mockReset()
  })

  it('renders the send-message trigger in the header action cluster', () => {
    renderWithProviders(
      <DealDetailHeader
        deal={{
          id: 'deal-1',
          title: 'Expansion renewal',
          status: 'qualified',
          pipelineStage: 'Discovery',
          valueAmount: '12000',
          valueCurrency: 'USD',
          expectedCloseAt: null,
          createdAt: '2026-04-10T08:00:00.000Z',
          closureOutcome: null,
          organizationId: 'org-1',
        }}
        owner={null}
        people={[]}
        companies={[]}
        pipelineName="Default"
        onSave={jest.fn()}
        onDelete={jest.fn()}
        isDirty={false}
        isSaving={false}
      />,
    )

    expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument()
    expect(mockSendObjectMessageDialog).toHaveBeenCalledWith(expect.objectContaining({
      object: expect.objectContaining({
        entityModule: 'customers',
        entityType: 'deal',
        entityId: 'deal-1',
      }),
      buttonVariant: 'outline',
      buttonSize: 'icon',
    }))
  })

  it('triggers deletion directly from the trash action', () => {
    const onDelete = jest.fn(async () => undefined)

    renderWithProviders(
      <DealDetailHeader
        deal={{
          id: 'deal-1',
          title: 'Expansion renewal',
          status: 'qualified',
          pipelineStage: 'Discovery',
          valueAmount: '12000',
          valueCurrency: 'USD',
          expectedCloseAt: null,
          createdAt: '2026-04-10T08:00:00.000Z',
          closureOutcome: null,
          organizationId: 'org-1',
        }}
        owner={null}
        people={[]}
        companies={[]}
        pipelineName="Default"
        onSave={jest.fn()}
        onDelete={onDelete}
        isDirty={false}
        isSaving={false}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('offers stage progression from the header actions', () => {
    const onStageChange = jest.fn()

    renderWithProviders(
      <DealDetailHeader
        deal={{
          id: 'deal-1',
          title: 'Expansion renewal',
          status: 'qualified',
          pipelineStage: 'Discovery',
          valueAmount: '12000',
          valueCurrency: 'USD',
          expectedCloseAt: null,
          createdAt: '2026-04-10T08:00:00.000Z',
          closureOutcome: null,
          organizationId: 'org-1',
        }}
        owner={null}
        people={[]}
        companies={[]}
        pipelineName="Default"
        stageOptions={[
          { id: 'stage-1', label: 'Discovery', order: 1 },
          { id: 'stage-2', label: 'Proposal', order: 2 },
        ]}
        currentStageId="stage-1"
        onStageChange={onStageChange}
        onSave={jest.fn()}
        onDelete={jest.fn()}
        isDirty={false}
        isSaving={false}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Discovery/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Proposal' }))

    expect(onStageChange).toHaveBeenCalledWith('stage-2')
  })
})
