/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { emitOrganizationScopeChanged } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { CreatedByFact } from '../CreatedByFact'

const resolveAuthorUserNamesMock = jest.fn()

jest.mock('../authorUserLookup', () => ({
  resolveAuthorUserNames: (...args: unknown[]) => resolveAuthorUserNamesMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => ({
    'customers.detail.createdBy.label': 'Created by',
    'customers.detail.createdBy.unknown': 'Unknown creator',
  }[key] ?? key),
}))

const CREATOR_A = '11111111-1111-4111-8111-111111111111'
const CREATOR_B = '22222222-2222-4222-8222-222222222222'

type LookupResult = {
  names: Map<string, string>
  resolvedIds: string[]
}

function deferred<TValue>() {
  let resolvePromise!: (value: TValue) => void
  const promise = new Promise<TValue>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

function renderFact(props: Partial<React.ComponentProps<typeof CreatedByFact>> = {}) {
  return render(<CreatedByFact createdByUserId={CREATOR_A} {...props} />)
}

describe('CreatedByFact', () => {
  beforeEach(() => {
    resolveAuthorUserNamesMock.mockReset()
    resolveAuthorUserNamesMock.mockResolvedValue({ names: new Map(), resolvedIds: [] })
  })

  it('renders the resolved creator name', async () => {
    resolveAuthorUserNamesMock.mockResolvedValueOnce({
      names: new Map([[CREATOR_A, 'Ada Lovelace']]),
      resolvedIds: [CREATOR_A],
    })

    renderFact()

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.queryByText(CREATOR_A)).not.toBeInTheDocument()
  })

  it('renders an unknown creator immediately for a null id without a lookup', () => {
    renderFact({ createdByUserId: null })

    expect(screen.getByText('Unknown creator')).toBeInTheDocument()
    expect(resolveAuthorUserNamesMock).not.toHaveBeenCalled()
  })

  it.each([
    ['a successful lookup with no matching row', { names: new Map([[CREATOR_B, 'Other user']]), resolvedIds: [CREATOR_A] }],
    ['an empty lookup response such as a 403', { names: new Map(), resolvedIds: [] }],
    ['a lookup whose label is the raw UUID', { names: new Map([[CREATOR_A, CREATOR_A]]), resolvedIds: [CREATOR_A] }],
  ])('renders unknown and never the UUID for %s', async (_caseName, result) => {
    resolveAuthorUserNamesMock.mockResolvedValueOnce(result)

    renderFact()

    expect(await screen.findByText('Unknown creator')).toBeInTheDocument()
    expect(screen.queryByText(CREATOR_A)).not.toBeInTheDocument()
  })

  it('renders unknown and never the UUID when the lookup rejects', async () => {
    resolveAuthorUserNamesMock.mockRejectedValueOnce(new Error('forbidden'))

    renderFact()

    expect(await screen.findByText('Unknown creator')).toBeInTheDocument()
    expect(screen.queryByText(CREATOR_A)).not.toBeInTheDocument()
  })

  it('renders a neutral placeholder while the lookup is pending', async () => {
    resolveAuthorUserNamesMock.mockReturnValueOnce(new Promise<LookupResult>(() => {}))

    renderFact()

    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText('Unknown creator')).not.toBeInTheDocument()
    expect(screen.queryByText(CREATOR_A)).not.toBeInTheDocument()
    await waitFor(() => expect(resolveAuthorUserNamesMock).toHaveBeenCalledTimes(1))
  })

  it('clears a resolved name when the creator id changes', async () => {
    const secondRequest = deferred<LookupResult>()
    resolveAuthorUserNamesMock
      .mockResolvedValueOnce({ names: new Map([[CREATOR_A, 'First creator']]), resolvedIds: [CREATOR_A] })
      .mockReturnValueOnce(secondRequest.promise)
    const { rerender } = renderFact()
    expect(await screen.findByText('First creator')).toBeInTheDocument()

    rerender(<CreatedByFact createdByUserId={CREATOR_B} />)

    expect(screen.queryByText('First creator')).not.toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('ignores a late response for the previous creator id', async () => {
    const firstRequest = deferred<LookupResult>()
    const secondRequest = deferred<LookupResult>()
    resolveAuthorUserNamesMock
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise)
    const { rerender } = renderFact()
    await waitFor(() => expect(resolveAuthorUserNamesMock).toHaveBeenCalledTimes(1))

    rerender(<CreatedByFact createdByUserId={CREATOR_B} />)
    await waitFor(() => expect(resolveAuthorUserNamesMock).toHaveBeenCalledTimes(2))
    await act(async () => {
      firstRequest.resolve({ names: new Map([[CREATOR_A, 'Late creator']]), resolvedIds: [CREATOR_A] })
    })

    expect(screen.queryByText('Late creator')).not.toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()

    await act(async () => {
      secondRequest.resolve({ names: new Map([[CREATOR_B, 'Current creator']]), resolvedIds: [CREATOR_B] })
    })
    expect(await screen.findByText('Current creator')).toBeInTheDocument()
  })

  it('clears a resolved name when the organization changes with the same creator id', async () => {
    const nextRequest = deferred<LookupResult>()
    resolveAuthorUserNamesMock
      .mockResolvedValueOnce({ names: new Map([[CREATOR_A, 'Previous organization creator']]), resolvedIds: [CREATOR_A] })
      .mockReturnValueOnce(nextRequest.promise)
    renderFact()
    expect(await screen.findByText('Previous organization creator')).toBeInTheDocument()

    act(() => {
      emitOrganizationScopeChanged({ organizationId: 'next-organization', tenantId: 'test-tenant' })
    })

    expect(screen.queryByText('Previous organization creator')).not.toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(resolveAuthorUserNamesMock).toHaveBeenNthCalledWith(2, [CREATOR_A], expect.any(AbortSignal))

    await act(async () => {
      nextRequest.resolve({ names: new Map([[CREATOR_A, 'Current organization creator']]), resolvedIds: [CREATOR_A] })
    })
    expect(await screen.findByText('Current organization creator')).toBeInTheDocument()
  })

  it('ignores a late response when the same creator lookup is denied in the new organization', async () => {
    const previousRequest = deferred<LookupResult>()
    resolveAuthorUserNamesMock
      .mockReturnValueOnce(previousRequest.promise)
      .mockResolvedValueOnce({ names: new Map(), resolvedIds: [] })
    renderFact()
    await waitFor(() => expect(resolveAuthorUserNamesMock).toHaveBeenCalledTimes(1))
    const previousSignal = resolveAuthorUserNamesMock.mock.calls[0]?.[1] as AbortSignal

    act(() => {
      emitOrganizationScopeChanged({ organizationId: 'denied-organization', tenantId: 'test-tenant' })
    })
    expect(await screen.findByText('Unknown creator')).toBeInTheDocument()
    expect(resolveAuthorUserNamesMock).toHaveBeenNthCalledWith(2, [CREATOR_A], expect.any(AbortSignal))
    expect(previousSignal.aborted).toBe(true)

    await act(async () => {
      previousRequest.resolve({ names: new Map([[CREATOR_A, 'Late organization creator']]), resolvedIds: [CREATOR_A] })
    })

    expect(screen.getByText('Unknown creator')).toBeInTheDocument()
    expect(screen.queryByText('Late organization creator')).not.toBeInTheDocument()
    expect(screen.queryByText(CREATOR_A)).not.toBeInTheDocument()
  })

  it('reuses a real owner name when the owner and creator ids match', () => {
    renderFact({ ownerUserId: CREATOR_A, ownerName: 'Grace Hopper' })

    expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
    expect(resolveAuthorUserNamesMock).not.toHaveBeenCalled()
  })

  it.each(['   ', CREATOR_A])('falls through to lookup for the owner label %p', async (ownerName) => {
    resolveAuthorUserNamesMock.mockResolvedValueOnce({
      names: new Map([[CREATOR_A, 'Resolved owner']]),
      resolvedIds: [CREATOR_A],
    })

    renderFact({ ownerUserId: CREATOR_A, ownerName })

    expect(await screen.findByText('Resolved owner')).toBeInTheDocument()
    expect(resolveAuthorUserNamesMock).toHaveBeenCalledTimes(1)
  })

  it('aborts the lookup when unmounted', async () => {
    resolveAuthorUserNamesMock.mockReturnValueOnce(new Promise<LookupResult>(() => {}))
    const { unmount } = renderFact()
    await waitFor(() => expect(resolveAuthorUserNamesMock).toHaveBeenCalledTimes(1))
    const signal = resolveAuthorUserNamesMock.mock.calls[0]?.[1] as AbortSignal

    unmount()

    expect(signal.aborted).toBe(true)
  })
})
