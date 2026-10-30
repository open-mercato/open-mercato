/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

jest.mock('@open-mercato/core/generated-shims/entities.ids.generated', () => ({
  E: new Proxy({}, {
    get: (_target, moduleId) => new Proxy({}, {
      get: (_entity, entityId) => `${String(moduleId)}:${String(entityId)}`,
    }),
  }),
}))

jest.mock('next/dynamic', () => () => function DocumentStructurePanelStub() {
  return <div data-testid="structure-panel" />
})

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: false, status: 500, result: null })),
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: ({ hideFooterActions, submitLabel }: { hideFooterActions?: boolean; submitLabel?: string }) =>
    hideFooterActions ? <div data-testid="crud-form" /> : (
      <div data-testid="crud-form">
        <button type="submit">{submitLabel}</button>
      </div>
    ),
}))

import { AttachmentMetadataDialog, type AttachmentItem } from '../AttachmentMetadataDialog'

const item: AttachmentItem = {
  id: 'att-1',
  fileName: 'manual.pdf',
  fileSize: 2048,
  mimeType: 'application/pdf',
  tags: [],
  assignments: [],
}

function selectTab(name: RegExp) {
  const trigger = screen.getByRole('tab', { name })
  fireEvent.mouseDown(trigger, { button: 0, ctrlKey: false })
  fireEvent.click(trigger)
}

describe('AttachmentMetadataDialog tabs', () => {
  it('hides the Save action on the Structure tab and restores it on Details', async () => {
    renderWithProviders(
      <AttachmentMetadataDialog
        open
        onOpenChange={jest.fn()}
        item={item}
        availableTags={[]}
        onSave={jest.fn(async () => undefined)}
      />,
    )

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()

    selectTab(/Structure/)
    await waitFor(() => expect(screen.getByTestId('structure-panel')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()

    selectTab(/Details/)
    await waitFor(() => expect(screen.queryByTestId('structure-panel')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('closes on Escape while the Structure tab is shown', async () => {
    const onOpenChange = jest.fn()
    renderWithProviders(
      <AttachmentMetadataDialog
        open
        onOpenChange={onOpenChange}
        item={item}
        availableTags={[]}
        onSave={jest.fn(async () => undefined)}
      />,
    )

    selectTab(/Structure/)
    const panel = await screen.findByTestId('structure-panel')
    fireEvent.keyDown(panel, { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
