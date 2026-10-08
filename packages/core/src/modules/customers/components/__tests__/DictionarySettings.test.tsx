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
const runMutationMock = jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => operation())

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
  withScopedApiRequestHeaders: (_headers: unknown, fn: () => Promise<unknown>) => fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: (...args: unknown[]) => runMutationMock(...(args as [{ operation: () => Promise<unknown> }])),
    retryLastMutation: jest.fn(),
  }),
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
  DictionaryForm: ({
    initialValues,
    onSubmit,
  }: {
    initialValues: { value: string; label: string; color: string | null; icon: string | null }
    onSubmit: (values: { value: string; label: string; color: string | null; icon: string | null }) => Promise<void>
  }) => (
    <div>
      <output data-testid="dictionary-form-label">{initialValues.label}</output>
      <button type="button" onClick={() => { void onSubmit({ ...initialValues, color: '#112233' }) }}>
        submit-color-change
      </button>
    </div>
  ),
}))

jest.mock('@open-mercato/core/modules/dictionaries/components/DictionaryTable', () => ({
  DictionaryTable: ({
    entries,
    onEdit,
    onDelete,
    translations,
  }: {
    entries: Array<Record<string, unknown>>
    onEdit?: (entry: Record<string, unknown>) => void
    onDelete?: (entry: Record<string, unknown>) => void
    translations: { title: string }
  }) => {
    const firstEntry = entries[0]
    return (
      <div>
        <div>{translations.title}</div>
        {firstEntry ? (
          <>
            <span>{`${translations.title}-label-${String(firstEntry.label)}`}</span>
            <button type="button" onClick={() => onEdit?.(firstEntry)}>
              {`edit-${translations.title}`}
            </button>
            <button type="button" onClick={() => onDelete?.(firstEntry)}>
              {`delete-${translations.title}`}
            </button>
          </>
        ) : null}
      </div>
    )
  },
}))

describe('DictionarySettings', () => {
  const originalHash = window.location.hash
  const originalScrollIntoView = Element.prototype.scrollIntoView

  beforeEach(() => {
    jest.clearAllMocks()
    window.location.hash = originalHash
    confirmMock.mockResolvedValue(false)
    readApiResultOrThrowMock.mockImplementation(async (path: string) => {
      if (path === '/api/customers/dictionaries/person-company-roles?labels=base') {
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

  afterEach(() => {
    window.location.hash = originalHash
    if (originalScrollIntoView) {
      Element.prototype.scrollIntoView = originalScrollIntoView
    } else {
      delete (Element.prototype as Partial<Element>).scrollIntoView
    }
  })

  it('blocks deleting role types that are already in use before sending the request', async () => {
    renderWithProviders(<DictionarySettings />)

    await waitFor(() => {
      expect(readApiResultOrThrowMock).toHaveBeenCalledWith(
        '/api/customers/dictionaries/person-company-roles?labels=base',
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

  it('renders the Interaction statuses management section', async () => {
    renderWithProviders(<DictionarySettings />)

    expect((await screen.findAllByText('Interaction statuses')).length).toBeGreaterThan(0)
    await waitFor(() => {
      expect(readApiResultOrThrowMock).toHaveBeenCalledWith(
        '/api/customers/dictionaries/interaction-statuses?labels=base',
        undefined,
        expect.any(Object),
      )
    })
  })

  it('scrolls the linked customer dictionary section after rendering', async () => {
    const scrollIntoView = jest.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    window.location.hash = '#customer-dictionary-job-titles'

    renderWithProviders(<DictionarySettings />)

    const target = document.getElementById('customer-dictionary-job-titles')
    expect(target).toBeTruthy()

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
    })
    expect(scrollIntoView.mock.contexts).toContain(target)
  })

  it('routes a confirmed dictionary delete through the guarded mutation runner', async () => {
    confirmMock.mockResolvedValue(true)
    apiCallOrThrowMock.mockResolvedValue(undefined)
    readApiResultOrThrowMock.mockImplementation(async (path: string) => {
      if (path === '/api/customers/dictionaries/statuses?labels=base') {
        return {
          items: [
            {
              id: 'status-1',
              value: 'active',
              label: 'Active',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        }
      }
      return { items: [] }
    })

    renderWithProviders(<DictionarySettings />)

    fireEvent.click(await screen.findByRole('button', { name: 'delete-Statuses' }))

    await waitFor(() => {
      expect(runMutationMock).toHaveBeenCalledTimes(1)
    })
    expect(runMutationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          resourceKind: 'customers.dictionary',
          retryLastMutation: expect.any(Function),
        }),
        mutationPayload: expect.objectContaining({ action: 'delete', id: 'status-1', kind: 'statuses' }),
      }),
    )
    expect(apiCallOrThrowMock).toHaveBeenCalledWith(
      '/api/customers/dictionaries/statuses/status-1',
      { method: 'DELETE' },
      expect.any(Object),
    )
  })

  it('edits the stored base label under a non-English locale', async () => {
    apiCallOrThrowMock.mockResolvedValue(undefined)
    readApiResultOrThrowMock.mockImplementation(async (path: string) => {
      if (path === '/api/customers/dictionaries/statuses?labels=base') {
        return {
          items: [
            {
              id: 'status-1',
              value: 'active',
              label: 'Active',
              color: '#3366ff',
              icon: null,
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        }
      }
      if (path === '/api/customers/dictionaries/statuses') {
        return { items: [{ id: 'status-1', value: 'active', label: 'Aktywny', color: '#3366ff', icon: null }] }
      }
      return { items: [] }
    })

    renderWithProviders(<DictionarySettings />, { locale: 'pl' })

    expect(await screen.findByText('Statuses-label-Active')).toBeInTheDocument()
    expect(readApiResultOrThrowMock).not.toHaveBeenCalledWith(
      '/api/customers/dictionaries/statuses',
      undefined,
      expect.any(Object),
    )

    fireEvent.click(screen.getByRole('button', { name: 'edit-Statuses' }))
    expect(screen.getByTestId('dictionary-form-label')).toHaveTextContent('Active')

    fireEvent.click(screen.getByRole('button', { name: 'submit-color-change' }))

    await waitFor(() => {
      expect(apiCallOrThrowMock).toHaveBeenCalledWith(
        '/api/customers/dictionaries/statuses/status-1',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ color: '#112233' }) }),
        expect.any(Object),
      )
    })
  })
})
