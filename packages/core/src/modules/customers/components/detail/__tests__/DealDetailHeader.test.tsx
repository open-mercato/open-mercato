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
        actions={<button type="button">Extension action</button>}
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
    expect(screen.getByRole('button', { name: 'Extension action' }).parentElement).toBe(screen.getByRole('button', { name: 'Send message' }).parentElement)
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

  it('keeps the stage out of the header chips', () => {
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

    expect(screen.queryByText('Discovery')).not.toBeInTheDocument()
    expect(screen.queryByText('Deal')).not.toBeInTheDocument()
    expect(screen.getByText('Expansion renewal')).toBeInTheDocument()
  })
})
