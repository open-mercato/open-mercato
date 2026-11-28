/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, within } from '@testing-library/react'
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

  describe('deprecated stage inputs', () => {
    const deal = {
      id: 'deal-1',
      title: 'Expansion renewal',
      status: 'qualified',
      pipelineStage: 'Discovery',
      valueAmount: '12000',
      valueCurrency: 'USD',
      expectedCloseAt: null,
      createdAt: '2026-04-10T08:00:00.000Z',
      closureOutcome: null as 'won' | 'lost' | null,
      organizationId: 'org-1',
    }
    const stageOptions = [
      { id: 'stage-1', label: 'Discovery', order: 1 },
      { id: 'stage-2', label: 'Proposal', order: 2 },
      { id: 'stage-won', label: 'Won', order: 3 },
    ]

    function renderHeader(overrides: Partial<React.ComponentProps<typeof DealDetailHeader>> = {}) {
      const onStageChange = jest.fn()
      renderWithProviders(
        <DealDetailHeader
          deal={deal}
          owner={null}
          people={[]}
          companies={[]}
          pipelineName="Default"
          stageOptions={stageOptions}
          currentStageId="stage-1"
          onStageChange={onStageChange}
          onSave={jest.fn()}
          onDelete={jest.fn()}
          isDirty={false}
          isSaving={false}
          {...overrides}
        />,
      )
      return onStageChange
    }

    it('still renders a stage menu in the action cluster and forwards the chosen stage', () => {
      const onStageChange = renderHeader()

      const trigger = screen.getByRole('button', { name: 'Discovery' })
      expect(trigger.parentElement).toBe(screen.getByRole('button', { name: 'Send message' }).parentElement)
      fireEvent.click(trigger)
      const menu = within(screen.getByRole('dialog'))
      expect(menu.queryByRole('button', { name: 'Won' })).not.toBeInTheDocument()
      fireEvent.click(menu.getByRole('button', { name: 'Proposal' }))
      expect(onStageChange).toHaveBeenCalledWith('stage-2')
    })

    it.each([
      ['the form is dirty', { isDirty: true }],
      ['the form is saving', { isSaving: true }],
      ['a stage change is in flight', { isStageSaving: true }],
    ])('disables the stage menu while %s', (_name, overrides) => {
      renderHeader(overrides)
      expect(screen.getByRole('button', { name: 'Discovery' })).toBeDisabled()
    })

    it('drops the stage menu once the deal is closed or without a callback', () => {
      renderHeader({ deal: { ...deal, closureOutcome: 'won' } })
      expect(screen.queryByRole('button', { name: 'Discovery' })).not.toBeInTheDocument()
      renderHeader({ onStageChange: undefined })
      expect(screen.queryByRole('button', { name: 'Discovery' })).not.toBeInTheDocument()
    })
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
