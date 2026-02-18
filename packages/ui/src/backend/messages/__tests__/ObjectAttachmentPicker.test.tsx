/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ObjectAttachmentPicker, type MessageObjectInput, type MessageObjectTypeItem } from '../ObjectAttachmentPicker'

const resolveMessageObjectPickerComponentMock = jest.fn()

jest.mock('@open-mercato/core/modules/messages/components/typeUiRegistry', () => ({
  resolveMessageObjectPickerComponent: (...args: unknown[]) => resolveMessageObjectPickerComponentMock(...args),
}))

describe('ObjectAttachmentPicker', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  const objectTypes: MessageObjectTypeItem[] = [
    {
      module: 'staff',
      entityType: 'leave_request',
      labelKey: 'staff.messageObjects.leaveRequest',
      icon: 'calendar-clock',
      actions: [],
    },
  ]

  it('attaches object from dedicated domain picker component', () => {
    const onConfirm = jest.fn()
    const DedicatedPicker = ({ onSelectRecord }: { onSelectRecord: (value: { id: string; label: string } | null) => void }) => (
      <button
        type="button"
        onClick={() => onSelectRecord({ id: '11111111-1111-4111-8111-111111111111', label: 'Leave request' })}
      >
        Select dedicated record
      </button>
    )
    resolveMessageObjectPickerComponentMock.mockReturnValue(DedicatedPicker)

    renderWithProviders(
      <ObjectAttachmentPicker
        open
        onOpenChange={jest.fn()}
        messageType="default"
        objectTypes={objectTypes}
        existingObjects={[]}
        onConfirm={onConfirm}
      />,
      { dict: {} },
    )

    fireEvent.change(screen.getByLabelText('Object type'), {
      target: { value: 'staff:leave_request' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Select dedicated record' }))
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }))

    expect(onConfirm).toHaveBeenCalledWith({
      entityModule: 'staff',
      entityType: 'leave_request',
      entityId: '11111111-1111-4111-8111-111111111111',
      actionRequired: false,
      actionType: undefined,
      actionLabel: undefined,
    })
  })

  it('attaches object through manual fallback when no picker is registered', () => {
    const onConfirm = jest.fn()
    resolveMessageObjectPickerComponentMock.mockReturnValue(null)

    renderWithProviders(
      <ObjectAttachmentPicker
        open
        onOpenChange={jest.fn()}
        messageType="default"
        objectTypes={objectTypes}
        existingObjects={[]}
        onConfirm={onConfirm}
      />,
      { dict: {} },
    )

    fireEvent.change(screen.getByLabelText('Object type'), {
      target: { value: 'staff:leave_request' },
    })

    expect(screen.getByText('No domain picker is registered for this object type. Provide entity reference manually.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Entity module'), { target: { value: 'staff' } })
    fireEvent.change(screen.getByLabelText('Entity type'), { target: { value: 'leave_request' } })
    fireEvent.change(screen.getByLabelText('Entity id'), { target: { value: '22222222-2222-4222-8222-222222222222' } })
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }))

    expect(onConfirm).toHaveBeenCalledWith({
      entityModule: 'staff',
      entityType: 'leave_request',
      entityId: '22222222-2222-4222-8222-222222222222',
      actionRequired: false,
      actionType: undefined,
      actionLabel: undefined,
    })
  })

  it('blocks duplicate manual object attachment', () => {
    const onConfirm = jest.fn()
    resolveMessageObjectPickerComponentMock.mockReturnValue(null)
    const existingObjects: MessageObjectInput[] = [
      {
        entityModule: 'staff',
        entityType: 'leave_request',
        entityId: '33333333-3333-4333-8333-333333333333',
        actionRequired: false,
      },
    ]

    renderWithProviders(
      <ObjectAttachmentPicker
        open
        onOpenChange={jest.fn()}
        messageType="default"
        objectTypes={objectTypes}
        existingObjects={existingObjects}
        onConfirm={onConfirm}
      />,
      { dict: {} },
    )

    fireEvent.change(screen.getByLabelText('Object type'), {
      target: { value: 'staff:leave_request' },
    })
    fireEvent.change(screen.getByLabelText('Entity id'), { target: { value: '33333333-3333-4333-8333-333333333333' } })
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }))

    expect(screen.getByText('This object is already attached.')).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
