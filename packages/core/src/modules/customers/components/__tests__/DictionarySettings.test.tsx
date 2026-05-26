/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import DictionarySettings from '../DictionarySettings'

const apiCallOrThrowMock = jest.fn()
const readApiResultOrThrowMock = jest.fn()
const confirmMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 0,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: (...args: unknown[]) => confirmMock(...args),
    ConfirmDialogElement: null,
  }),
}))

jest.mock('@open-mercato/core/modules/dictionaries/components/DictionaryForm', () => ({
  DictionaryForm: () => null,
}))

jest.mock('@open-mercato/core/modules/dictionaries/components/DictionaryTable', () => ({
  DictionaryTable: ({
    entries,
    onDelete,
    translations,
  }: {
    entries: Array<Record<string, unknown>>
    onDelete?: (entry: Record<string, unknown>) => void
    translations: { title: string }
  }) => {
    const firstEntry = entries[0]
    return (
      <div>
        <div>{translations.title}</div>
        {firstEntry ? (
          <button type="button" onClick={() => onDelete?.(firstEntry)}>
            {`delete-${translations.title}`}
          </button>
        ) : null}
      </div>
    )
  },
}))

describe('DictionarySettings', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    confirmMock.mockResolvedValue(false)
    readApiResultOrThrowMock.mockImplementation(async (path: string) => {
      if (path === '/api/customers/dictionaries/person-company-roles') {
        return {
          items: [
            {
              id: 'role-1',
              value: 'renewal_owner',
              label: 'Renewal Owner',
              usageCount: 3,
            },
          ],
        }
      }
      return { items: [] }
    })
  })

  it('blocks deleting role types that are already in use before sending the request', async () => {
    renderWithProviders(<DictionarySettings />)

    await waitFor(() => {
      expect(readApiResultOrThrowMock).toHaveBeenCalledWith(
        '/api/customers/dictionaries/person-company-roles',
        undefined,
        expect.any(Object),
      )
    })

    fireEvent.click(await screen.findByRole('button', { name: 'delete-Role types' }))

    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Role type is in use',
        description: 'This role type is assigned to 3 records. Remove or replace those assignments before deleting it.',
        confirmText: false,
      }),
    )
    expect(apiCallOrThrowMock).not.toHaveBeenCalled()
  })
})
