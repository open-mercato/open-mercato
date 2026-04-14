/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { EntityTagsDialog } from '../EntityTagsDialog'

const apiCallMock = jest.fn()
const readApiResultOrThrowMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('../ManageTagsDialog', () => ({
  ManageTagsDialog: ({ open }: { open: boolean }) => (open ? <div>manage-tags-dialog</div> : null),
}))

describe('EntityTagsDialog', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    readApiResultOrThrowMock.mockReset()
    apiCallMock.mockResolvedValue({ ok: true, result: { items: [] } })
    readApiResultOrThrowMock.mockResolvedValue({ items: [], assignedIds: [] })
  })

  it('opens tag settings from the manage-tags modal header', async () => {
    await act(async () => {
      renderWithProviders(
        <EntityTagsDialog
          open
          onClose={jest.fn()}
          entityId="person-1"
          entityType="person"
          entityOrganizationId="org-1"
          entityData={{}}
        />,
      )
    })

    fireEvent.click(screen.getByRole('button', { name: 'Tag settings' }))

    expect(screen.getByText('manage-tags-dialog')).toBeInTheDocument()
  })
})
