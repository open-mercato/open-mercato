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

jest.mock('../RolesSection', () => ({
  RolesSection: () => null,
}))

jest.mock('../CreatePersonDialog', () => ({
  CreatePersonDialog: ({
    open,
  }: {
    open: boolean
  }) => (open ? <div>Add new person</div> : null),
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div data-testid="dialog-content" {...props}>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

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

  it('opens the inline create dialog from the empty state', () => {
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

    expect(screen.getByText('Add new person')).toBeInTheDocument()
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

    const checkbox = await screen.findByRole('checkbox', { name: 'Select Ada Lovelace' })
    fireEvent.click(checkbox)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Link selected' }))
    })

    expect(runGuardedMutation).toHaveBeenCalled()
    expect(apiCallOrThrowMock).toHaveBeenCalledWith(
      '/api/customers/people/person-2/companies',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ companyId: 'company-123' }),
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

  it('links multiple existing people from the same dialog', async () => {
    const runGuardedMutation = jest.fn(async <T,>(operation: () => Promise<T>) => operation())
    const onPeopleChange = jest.fn()
    readApiResultOrThrowMock.mockResolvedValue({
      items: [
        {
          id: 'person-2',
          display_name: 'Ada Lovelace',
          primary_email: 'ada@example.com',
        },
        {
          id: 'person-3',
          display_name: 'Grace Hopper',
          primary_email: 'grace@example.com',
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
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Ada Lovelace' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Grace Hopper' }))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Link selected' }))
    })

    expect(apiCallOrThrowMock).toHaveBeenNthCalledWith(
      1,
      '/api/customers/people/person-2/companies',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ companyId: 'company-123' }),
      }),
      expect.any(Object),
    )
    expect(apiCallOrThrowMock).toHaveBeenNthCalledWith(
      2,
      '/api/customers/people/person-3/companies',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ companyId: 'company-123' }),
      }),
      expect.any(Object),
    )
    await waitFor(() => {
      expect(onPeopleChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 'person-2', displayName: 'Ada Lovelace' }),
          expect.objectContaining({ id: 'person-3', displayName: 'Grace Hopper' }),
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
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Ada Lovelace' }))

    const dialog = screen.getByTestId('dialog-content')

    await act(async () => {
      fireEvent.keyDown(dialog, { key: 'Enter', metaKey: true })
    })

    expect(apiCallOrThrowMock).toHaveBeenCalledWith(
      '/api/customers/people/person-2/companies',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ companyId: 'company-123' }),
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
      fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Ada Lovelace' }))

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Link selected' }))
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
      '/api/customers/people/person-1/companies/company-123',
      expect.objectContaining({ method: 'DELETE' }),
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

  it('shows the people search controls by default when linked people exist', () => {
    renderWithProviders(
      <CompanyPeopleSection
        companyId="company-123"
        initialPeople={[
          {
            id: 'person-1',
            displayName: 'Grace Hopper',
            primaryEmail: 'grace@example.com',
          },
        ]}
        addActionLabel="Add person"
        emptyLabel="No linked people yet."
        emptyState={emptyState}
      />,
    )

    expect(screen.getByPlaceholderText('Search by name, role, email...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })
})
