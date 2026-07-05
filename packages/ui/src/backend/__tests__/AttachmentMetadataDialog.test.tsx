/** @jest-environment jsdom */

import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { AttachmentMetadataDialog, type AttachmentItem } from '../detail/AttachmentMetadataDialog'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/inputs/TagsInput', () => ({
  TagsInput: () => <div data-testid="tags-input" />,
}))

jest.mock('@open-mercato/core/generated-shims/entities.ids.generated', () => ({
  E: { attachments: { attachment: 'attachments.attachment' } },
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: ({ fields, initialValues }: { fields: any[]; initialValues?: Record<string, unknown> }) => (
    <form data-testid="mock-crud-form">
      {fields.map((field) => (
        <div key={field.id} data-crud-field-id={field.id}>
          {field.type === 'custom'
            ? field.component({
                id: field.id,
                value: initialValues?.[field.id],
                disabled: false,
                setValue: jest.fn(),
              })
            : null}
        </div>
      ))}
    </form>
  ),
}))

jest.mock('@open-mercato/core/modules/attachments/components/AttachmentContentPreview', () => ({
  AttachmentContentPreview: () => <div data-testid="attachment-content-preview" />,
}))

describe('AttachmentMetadataDialog assignment layout', () => {
  const longAssignment = {
    type: 'production_operations:production_order_with_a_very_long_assignment_type',
    id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479-f47ac10b-58cc-4372-a567-0e02b2c3d479',
    href:
      'https://example.test/backend/production/operations/orders/f47ac10b-58cc-4372-a567-0e02b2c3d479/details/with/a/long/path',
    label: 'Production order with a long label',
  }

  const item: AttachmentItem = {
    id: 'attachment-1',
    fileName: 'work-order-photo.png',
    fileSize: 2048,
    mimeType: 'application/pdf',
    partitionCode: 'default',
    partitionTitle: 'Default',
    tags: [],
    assignments: [longAssignment],
  }

  beforeEach(() => {
    jest.resetAllMocks()
    ;(apiCall as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      response: { status: 200 },
      result: {
        item: {
          id: item.id,
          tags: [],
          assignments: [longAssignment],
          customFields: {},
          content: null,
        },
      },
    })
  })

  it('bounds long assignment rows inside the dialog and names the remove action', async () => {
    renderWithProviders(
      <AttachmentMetadataDialog
        open
        item={item}
        availableTags={[]}
        onOpenChange={jest.fn()}
        onSave={jest.fn()}
      />,
    )

    const typeInput = await screen.findByDisplayValue(longAssignment.type)
    const typeWrapper = typeInput.closest('[data-slot="input-wrapper"]')
    expect(typeWrapper).not.toBeNull()

    const fieldWrapper = typeWrapper?.parentElement
    const row = fieldWrapper?.parentElement
    expect(row).not.toBeNull()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
    })

    expect(row?.className).not.toContain('lg:grid-cols-[1.2fr_1.2fr_1.6fr_1fr_auto]')
    expect(row?.className).toContain(
      'lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1.6fr)_minmax(0,1fr)_auto]',
    )
    expect(row?.className).toContain('min-w-0')
    expect(fieldWrapper?.className).toContain('min-w-0')

    const inputWrappers = Array.from(row?.querySelectorAll('[data-slot="input-wrapper"]') ?? [])
    expect(inputWrappers).toHaveLength(4)
    inputWrappers.forEach((wrapper) => {
      expect((wrapper as HTMLElement).className).toContain('w-full')
      expect((wrapper as HTMLElement).className).toContain('min-w-0')
    })
  })
})
