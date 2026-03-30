/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CompanyPeopleSection, type CompanyPersonSummary } from '../CompanyPeopleSection'

const pushMock = jest.fn()
const flashMock = jest.fn()
const apiCallOrThrowMock = jest.fn()
const readApiResultOrThrowMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div data-testid="dialog-content" {...props}>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/inputs', () => {
  const React = require('react')

  return {
    LookupSelect: ({
      fetchOptions,
      onChange,
    }: {
      fetchOptions?: (query?: string) => Promise<Array<{ id: string; title: string }>>
      onChange: (next: string | null) => void
    }) => {
      const [items, setItems] = React.useState<Array<{ id: string; title: string }>>([])

      React.useEffect(() => {
        let cancelled = false
        fetchOptions?.('')
          .then((nextItems) => {
            if (!cancelled) setItems(nextItems)
          })
          .catch(() => {
            if (!cancelled) setItems([])
          })
        return () => {
          cancelled = true
        }
      }, [fetchOptions])

      return (
        <div>
          {items.map((item) => (
            <button key={item.id} type="button" onClick={() => onChange(item.id)}>
              {item.title}
            </button>
          ))}
        </div>
      )
    },
  }
})

describe('CompanyPeopleSection', () => {
  const emptyState = {
    title: 'Build the account team',
    actionLabel: 'Create person',
  }

  beforeEach(() => {
    pushMock.mockReset()
    flashMock.mockReset()
    apiCallOrThrowMock.mockReset()
    readApiResultOrThrowMock.mockReset()
  })

  it('preserves returnTo when creating a person from the empty state', () => {
    renderWithProviders(
      <CompanyPeopleSection
        companyId="company-123"
        initialPeople={[]}
        addActionLabel="Add person"
        emptyLabel="No linked people yet."
        emptyState={emptyState}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Create person' }))

    expect(pushMock).toHaveBeenCalledWith(
      '/backend/customers/people/create?companyId=company-123&returnTo=%2Fbackend%2Fcustomers%2Fcompanies-v2%2Fcompany-123%3Ftab%3Dpeople',
    )
  })

  it('links an existing person through the guarded mutation path', async () => {
    const runGuardedMutation = jest.fn(async <T,>(operation: () => Promise<T>) => operation())
    const onPeopleChange = jest.fn()
    readApiResultOrThrowMock.mockResolvedValue({
      items: [
        {
          id: 'person-2',
          display_name: 'Ada Lovelace',
          primary_email: 'ada@example.com',
          lifecycle_stage: 'Lead',
        },
      ],
    })
    apiCallOrThrowMock.mockResolvedValue({ ok: true })

    renderWithProviders(
      <CompanyPeopleSection
        companyId="company-123"
        initialPeople={[]}
        addActionLabel="Add person"
        emptyLabel="No linked people yet."
        emptyState={emptyState}
        onPeopleChange={onPeopleChange}
        runGuardedMutation={runGuardedMutation}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Link existing person' }))

    const optionButton = await screen.findByRole('button', { name: 'Ada Lovelace' })
    fireEvent.click(optionButton)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Link person' }))
    })

    expect(runGuardedMutation).toHaveBeenCalled()
    expect(apiCallOrThrowMock).toHaveBeenCalledWith(
      '/api/customers/people',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ id: 'person-2', companyEntityId: 'company-123' }),
      }),
      expect.any(Object),
    )
    await waitFor(() => {
      expect(onPeopleChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'person-2',
            displayName: 'Ada Lovelace',
          }),
        ]),
      )
    })
  })

  it('submits the link dialog on Cmd/Ctrl+Enter', async () => {
    const runGuardedMutation = jest.fn(async <T,>(operation: () => Promise<T>) => operation())
    readApiResultOrThrowMock.mockResolvedValue({
      items: [
        {
          id: 'person-2',
          display_name: 'Ada Lovelace',
        },
      ],
    })
    apiCallOrThrowMock.mockResolvedValue({ ok: true })

    renderWithProviders(
      <CompanyPeopleSection
        companyId="company-123"
        initialPeople={[]}
        addActionLabel="Add person"
        emptyLabel="No linked people yet."
        emptyState={emptyState}
        runGuardedMutation={runGuardedMutation}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Link existing person' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ada Lovelace' }))

    const dialog = screen.getByTestId('dialog-content')

    await act(async () => {
      fireEvent.keyDown(dialog, { key: 'Enter', metaKey: true })
    })

    expect(apiCallOrThrowMock).toHaveBeenCalledWith(
      '/api/customers/people',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ id: 'person-2', companyEntityId: 'company-123' }),
      }),
      expect.any(Object),
    )
  })

  it('does not trigger a setState-in-render warning when the parent syncs linked people', async () => {
    const runGuardedMutation = jest.fn(async <T,>(operation: () => Promise<T>) => operation())
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    readApiResultOrThrowMock.mockResolvedValue({
      items: [
        {
          id: 'person-2',
          display_name: 'Ada Lovelace',
        },
      ],
    })
    apiCallOrThrowMock.mockResolvedValue({ ok: true })

    function Harness() {
      const [people, setPeople] = React.useState<CompanyPersonSummary[]>([])
      return (
        <CompanyPeopleSection
          companyId="company-123"
          initialPeople={people}
          addActionLabel="Add person"
          emptyLabel="No linked people yet."
          emptyState={emptyState}
          onPeopleChange={setPeople}
          runGuardedMutation={runGuardedMutation}
        />
      )
    }

    try {
      renderWithProviders(<Harness />)

      fireEvent.click(screen.getByRole('button', { name: 'Link existing person' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Ada Lovelace' }))

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Link person' }))
      })

      await waitFor(() => {
        expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
      })

      const stateUpdateWarnings = consoleErrorSpy.mock.calls.filter((call) =>
        call.some((value) => typeof value === 'string' && value.includes('Cannot update a component'))
      )
      expect(stateUpdateWarnings).toHaveLength(0)
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('unlinks a person through the guarded mutation path', async () => {
    const runGuardedMutation = jest.fn(async <T,>(operation: () => Promise<T>) => operation())
    const onPeopleChange = jest.fn()
    const initialPeople: CompanyPersonSummary[] = [
      {
        id: 'person-1',
        displayName: 'Grace Hopper',
      },
    ]
    apiCallOrThrowMock.mockResolvedValue({ ok: true })

    renderWithProviders(
      <CompanyPeopleSection
        companyId="company-123"
        initialPeople={initialPeople}
        addActionLabel="Add person"
        emptyLabel="No linked people yet."
        emptyState={emptyState}
        onPeopleChange={onPeopleChange}
        runGuardedMutation={runGuardedMutation}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Unlink' }))
    })

    expect(runGuardedMutation).toHaveBeenCalled()
    expect(apiCallOrThrowMock).toHaveBeenCalledWith(
      '/api/customers/people',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ id: 'person-1', companyEntityId: null }),
      }),
      expect.any(Object),
    )
    await waitFor(() => {
      expect(onPeopleChange).toHaveBeenCalledWith([])
    })
  })

  it('keeps the add-person section action configured after the first person is linked', () => {
    const onActionChange = jest.fn()

    renderWithProviders(
      <CompanyPeopleSection
        companyId="company-123"
        initialPeople={[
          {
            id: 'person-1',
            displayName: 'Grace Hopper',
          },
        ]}
        addActionLabel="Add person"
        emptyLabel="No linked people yet."
        emptyState={emptyState}
        onActionChange={onActionChange}
      />,
    )

    expect(onActionChange).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Add person',
        onClick: expect.any(Function),
      }),
    )
  })
})
