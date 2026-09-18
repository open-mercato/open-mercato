/** @jest-environment jsdom */

import * as React from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'

const apiCallMock = jest.fn()

const translations: Record<string, string> = {
  'documents.actions.cancel': 'Cancel',
  'documents.actions.retry': 'Retry',
  'documents.entities.customerPerson': 'Customer',
  'documents.entities.deal': 'Deal',
  'documents.entityPicker.description': 'Search records from other modules and insert a reference.',
  'documents.entityPicker.empty': 'No record types are available.',
  'documents.entityPicker.error.search': 'Failed to search records.',
  'documents.entityPicker.loading': 'Searching...',
  'documents.entityPicker.loadingRegistry': 'Loading available record types...',
  'documents.entityPicker.noMatches': 'No matching records',
  'documents.entityPicker.prompt': 'Start typing to search.',
  'documents.entityPicker.searchLabel': 'Search',
  'documents.entityPicker.searchPlaceholder': 'Search records...',
  'documents.entityPicker.title': 'Insert record',
  'documents.entityPicker.typeTabs': 'Record types',
  'documents.entityPicker.unavailable': 'This record type is unavailable.',
  'documents.permissions.commenter': 'Commenter',
  'documents.permissions.editor': 'Editor',
  'documents.permissions.viewer': 'Viewer',
  'documents.roles.unknown': 'Unknown role',
  'documents.share.dialog.add': 'Add access',
  'documents.share.dialog.permission': 'Permission',
  'documents.share.dialog.principalSearch': 'User or role',
  'documents.share.dialog.principalType': 'Principal type',
  'documents.share.picker.clear': 'Clear selection',
  'documents.share.picker.error': 'Could not load people or roles.',
  'documents.share.picker.loadMore': 'Load more',
  'documents.share.picker.loading': 'Searching...',
  'documents.share.picker.noMatches': 'No matches',
  'documents.share.picker.retry': 'Retry',
  'documents.share.picker.searchRole': 'Search roles...',
  'documents.share.picker.searchUser': 'Search users...',
  'documents.share.picker.showing': 'Showing results',
  'documents.share.principalTypes.role': 'Role',
  'documents.share.principalTypes.user': 'User',
  'documents.users.unknown': 'Unknown user',
}

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => translations[key] ?? key,
}))

jest.mock('@open-mercato/shared/modules/widgets/injection-loader', () => {
  const enabledModuleIds = new Set(['customers', 'catalog', 'sales'])
  return {
    getEnabledModuleIds: () => enabledModuleIds,
    getInjectionRegistryVersion: () => 1,
    subscribeToInjectionRegistryChanges: () => () => undefined,
  }
})

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogContent: ({ children, onKeyDown }: { children: React.ReactNode; onKeyDown?: React.KeyboardEventHandler<HTMLDivElement> }) => (
    <div role="dialog" onKeyDown={onKeyDown}>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))

import { EntityPicker } from '../backend/documents/components/EntityPicker'
import { PrincipalPicker } from '../backend/documents/components/PrincipalPicker'
import { ShareDialogAddForm } from '../backend/documents/components/ShareDialogAddForm'

const ADA_ID = '11111111-1111-4111-8111-111111111111'
const GRACE_ID = '22222222-2222-4222-8222-222222222222'
const DOCUMENT_ID = '33333333-3333-4333-8333-333333333333'

async function flushPromises(iterations = 6): Promise<void> {
  for (let index = 0; index < iterations; index += 1) await Promise.resolve()
}

function expectNoGuidInReadableSurface(container: HTMLElement): void {
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  const describedText = Array.from(container.querySelectorAll('[aria-describedby]')).flatMap((node) => (
    (node.getAttribute('aria-describedby') ?? '').split(/\s+/).map((id) => container.ownerDocument.getElementById(id)?.textContent ?? '')
  ))
  const readableSurface = [
    container.textContent ?? '',
    ...Array.from(container.querySelectorAll('[aria-label]')).map((node) => node.getAttribute('aria-label') ?? ''),
    ...Array.from(container.querySelectorAll('[aria-description]')).map((node) => node.getAttribute('aria-description') ?? ''),
    ...Array.from(container.querySelectorAll('[title]')).map((node) => node.getAttribute('title') ?? ''),
    ...Array.from(container.querySelectorAll('img[alt]')).map((node) => node.getAttribute('alt') ?? ''),
    ...Array.from(container.querySelectorAll('input')).flatMap((node) => [node.value, node.placeholder]),
    ...describedText,
  ].join('\n')
  expect(readableSurface).not.toMatch(uuid)
  expect(Array.from(container.querySelectorAll('input')).map((node) => `${node.getAttribute('aria-label') ?? ''} ${node.getAttribute('placeholder') ?? ''}`).join('\n')).not.toMatch(/\b(?:uuid|guid|record id|principal id)\b/i)
}

describe('rendered Documents pickers', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    apiCallMock.mockReset()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('binds EntityPicker keyboard selection to the current readable query result', async () => {
    let resolveGrace: ((value: unknown) => void) | null = null
    apiCallMock.mockImplementation((url: string) => {
      if (url.includes('search=Ada')) {
        return Promise.resolve({ ok: true, result: { items: [{ id: ADA_ID, displayName: 'Ada Lovelace', primaryEmail: 'ada@example.com' }] } })
      }
      if (url.includes('search=Grace')) {
        return new Promise((resolve) => { resolveGrace = resolve })
      }
      throw new Error(`Unexpected entity search: ${url}`)
    })
    const onPick = jest.fn()
    const onOpenChange = jest.fn()
    const { container } = render(
      <EntityPicker open onOpenChange={onOpenChange} onPick={onPick} typeFilter={['customer-person']} />,
    )
    const input = screen.getByRole('combobox', { name: 'Search' })

    fireEvent.change(input, { target: { value: 'Ada' } })
    await act(async () => {
      jest.advanceTimersByTime(250)
      await flushPromises()
    })
    expect(screen.getByRole('option', { name: /Ada Lovelace/ })).toBeTruthy()
    expect(apiCallMock).toHaveBeenCalledWith(
      '/api/customers/people?search=Ada&page=1&pageSize=20',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      expect.anything(),
    )

    fireEvent.change(input, { target: { value: 'Grace' } })
    expect(screen.queryByText('Ada Lovelace')).toBeNull()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).not.toHaveBeenCalled()

    await act(async () => {
      jest.advanceTimersByTime(250)
      await Promise.resolve()
      resolveGrace?.({ ok: true, result: { items: [{ id: GRACE_ID, displayName: 'Grace Hopper', primaryEmail: 'grace@example.com' }] } })
      await flushPromises()
    })
    expect(screen.getByRole('option', { name: /Grace Hopper/ })).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onPick).toHaveBeenCalledWith({
      type: 'customer-person',
      id: GRACE_ID,
      label: 'Grace Hopper',
      href: `/backend/customers/people/${GRACE_ID}`,
      values: { name: 'Grace Hopper', email: 'grace@example.com', phone: null },
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expectNoGuidInReadableSurface(container)
  })

  it('does not select the active EntityPicker result when Enter comes from a tab or cancel action', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      result: { items: [{ id: ADA_ID, displayName: 'Ada Lovelace', primaryEmail: 'ada@example.com' }] },
    })
    const onPick = jest.fn()
    render(<EntityPicker open onOpenChange={jest.fn()} onPick={onPick} typeFilter={['customer-person']} />)
    const input = screen.getByRole('combobox', { name: 'Search' })

    fireEvent.change(input, { target: { value: 'Ada' } })
    await act(async () => {
      jest.advanceTimersByTime(250)
      await flushPromises()
    })
    expect(screen.getByRole('option', { name: /Ada Lovelace/ })).toBeTruthy()

    fireEvent.keyDown(screen.getByRole('radio', { name: 'Customer' }), { key: 'Enter' })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Enter' })

    expect(onPick).not.toHaveBeenCalled()
  })

  it.each([
    ['Cmd+Enter', { metaKey: true }],
    ['Ctrl+Enter', { ctrlKey: true }],
  ])('selects the active EntityPicker result exactly once for %s', async (_label, modifier) => {
    apiCallMock.mockResolvedValue({
      ok: true,
      result: { items: [{ id: ADA_ID, displayName: 'Ada Lovelace', primaryEmail: 'ada@example.com' }] },
    })
    const onPick = jest.fn()
    render(<EntityPicker open onOpenChange={jest.fn()} onPick={onPick} typeFilter={['customer-person']} />)
    const input = screen.getByRole('combobox', { name: 'Search' })

    fireEvent.change(input, { target: { value: 'Ada' } })
    await act(async () => {
      jest.advanceTimersByTime(250)
      await flushPromises()
    })
    expect(screen.getByRole('option', { name: /Ada Lovelace/ })).toBeTruthy()

    fireEvent.keyDown(input, { key: 'Enter', ...modifier })

    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: ADA_ID }))
  })

  it('keeps the combobox active index unset when an empty result receives arrow keys', async () => {
    apiCallMock.mockResolvedValue({ ok: true, result: { items: [] } })
    render(<EntityPicker open onOpenChange={jest.fn()} onPick={jest.fn()} typeFilter={['customer-person']} />)
    const input = screen.getByRole('combobox', { name: 'Search' })

    fireEvent.change(input, { target: { value: 'Nobody' } })
    await act(async () => {
      jest.advanceTimersByTime(250)
      await flushPromises()
    })
    expect(screen.getByText('No matching records')).toBeTruthy()

    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })

    expect(input.getAttribute('aria-activedescendant')).toBeNull()
    expect(document.querySelector('[role="option"]')).toBeNull()
  })

  it('renders a retry action for transient entity-search failures', async () => {
    apiCallMock
      .mockResolvedValueOnce({ ok: false, status: 503, result: { error: 'unavailable' } })
      .mockResolvedValueOnce({
        ok: true,
        result: { items: [{ id: ADA_ID, displayName: 'Ada Lovelace', primaryEmail: 'ada@example.com' }] },
      })
    render(<EntityPicker open onOpenChange={jest.fn()} onPick={jest.fn()} typeFilter={['customer-person']} />)

    fireEvent.change(screen.getByRole('combobox', { name: 'Search' }), { target: { value: 'Ada' } })
    await act(async () => {
      jest.advanceTimersByTime(250)
      await flushPromises()
    })
    expect(screen.getByText('Failed to search records.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await act(async () => {
      jest.advanceTimersByTime(250)
      await flushPromises()
    })
    expect(screen.getByRole('option', { name: /Ada Lovelace/ })).toBeTruthy()
  })

  it('uses the shared keyboard-navigable segmented control for record types', () => {
    render(
      <EntityPicker
        open
        onOpenChange={jest.fn()}
        onPick={jest.fn()}
        typeFilter={['customer-person', 'deal']}
      />,
    )

    const group = screen.getByRole('radiogroup', { name: 'Record types' })
    const customer = within(group).getByRole('radio', { name: 'Customer' })
    const deal = within(group).getByRole('radio', { name: 'Deal' })
    expect(group.getAttribute('class')).toEqual(expect.stringContaining('grid-cols-2'))
    expect(group.getAttribute('class')).toEqual(expect.stringContaining('sm:grid-cols-4'))
    expect(group.getAttribute('class')).toEqual(expect.stringContaining('h-auto'))
    expect(customer.getAttribute('class')).toEqual(expect.stringContaining('whitespace-normal'))
    expect(customer.getAttribute('aria-checked')).toBe('true')

    act(() => {
      customer.focus()
      fireEvent.keyDown(customer, { key: 'ArrowRight' })
      jest.runOnlyPendingTimers()
      fireEvent.keyUp(customer, { key: 'ArrowRight' })
    })

    expect(deal.getAttribute('aria-checked')).toBe('true')
  })

  it('renders PrincipalPicker as a label-first combobox and supports keyboard choice without an ID field', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      result: {
        items: [
          { id: ADA_ID, label: 'Ada Lovelace', secondary: 'ada@example.com' },
          { id: GRACE_ID, label: 'Grace Hopper', secondary: 'grace@example.com' },
        ],
        total: 2,
        totalPages: 1,
      },
    })
    const onChange = jest.fn()
    const { container } = render(
      <PrincipalPicker
        id="share-principal"
        documentId={DOCUMENT_ID}
        principalType="user"
        value={null}
        onChange={onChange}
      />,
    )
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'Hopper' } })
    await act(async () => {
      jest.advanceTimersByTime(250)
      await flushPromises()
    })
    expect(apiCallMock).toHaveBeenCalledWith(
      `/api/documents/${DOCUMENT_ID}/principals?mode=share&type=user&page=1&pageSize=20&search=Hopper`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      expect.anything(),
    )
    expect(screen.getByRole('option', { name: /Ada Lovelace/ })).toBeTruthy()
    expect(screen.getByRole('option', { name: /Grace Hopper/ })).toBeTruthy()

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(GRACE_ID, 'Grace Hopper (grace@example.com)')
    expect((input as HTMLInputElement).value).toBe('Grace Hopper (grace@example.com)')
    expectNoGuidInReadableSurface(container)
  })

  it('submits ShareDialogAddForm only after a searched readable principal is selected', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      result: { items: [{ id: ADA_ID, label: 'Ada Lovelace', secondary: 'ada@example.com' }], total: 1, totalPages: 1 },
    })
    const onPrincipalIdChange = jest.fn()
    const onSubmit = jest.fn(async () => undefined)
    const props = {
      documentId: DOCUMENT_ID,
      principalType: 'user' as const,
      principalId: '',
      permission: 'viewer' as const,
      canManage: true,
      isSubmitting: false,
      onPrincipalTypeChange: jest.fn(),
      onPrincipalIdChange,
      onPermissionChange: jest.fn(),
      onSubmit,
    }
    const { container, rerender } = render(<ShareDialogAddForm {...props} />)
    const form = container.querySelector('form')
    expect(form).not.toBeNull()
    const principalInput = screen.getByLabelText('User or role')
    expect((within(form!).getByRole('button', { name: 'Add access' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(principalInput, { target: { value: 'Ada' } })
    await act(async () => {
      jest.advanceTimersByTime(250)
      await flushPromises()
    })
    fireEvent.keyDown(principalInput, { key: 'Enter' })
    expect(onPrincipalIdChange).toHaveBeenCalledWith(ADA_ID)

    rerender(<ShareDialogAddForm {...props} principalId={ADA_ID} />)
    const addButton = within(form!).getByRole('button', { name: 'Add access' })
    expect((addButton as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(addButton)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect((screen.getByDisplayValue('Ada Lovelace (ada@example.com)') as HTMLInputElement).value).toBe('Ada Lovelace (ada@example.com)')
    expectNoGuidInReadableSurface(container)
  })

  it('renders safe missing/restricted fallbacks instead of UUID-shaped peer labels', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      result: { items: [{ id: ADA_ID, displayName: `Restricted ${ADA_ID}` }] },
    })
    const entity = render(
      <EntityPicker open onOpenChange={jest.fn()} onPick={jest.fn()} typeFilter={['customer-person']} />,
    )
    fireEvent.change(screen.getByRole('combobox', { name: 'Search' }), { target: { value: 'Restricted' } })
    await act(async () => {
      jest.advanceTimersByTime(250)
      await flushPromises()
    })
    expect(screen.getByText('No matching records')).toBeTruthy()
    expectNoGuidInReadableSurface(entity.container)
    entity.unmount()

    apiCallMock.mockReset().mockResolvedValue({
      ok: true,
      result: { items: [{ id: ADA_ID, label: ADA_ID, secondary: `hidden-${ADA_ID}` }], total: 1, totalPages: 1 },
    })
    const onChange = jest.fn()
    const principal = render(
      <PrincipalPicker documentId={DOCUMENT_ID} principalType="user" value={null} onChange={onChange} />,
    )
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'Missing' } })
    await act(async () => {
      jest.advanceTimersByTime(250)
      await flushPromises()
    })
    expect(screen.getByRole('option', { name: 'Unknown user' })).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(ADA_ID, 'Unknown user')
    expect((input as HTMLInputElement).value).toBe('Unknown user')
    expectNoGuidInReadableSurface(principal.container)
  })
})
