/** @jest-environment jsdom */

import * as React from 'react'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'

const apiCallMock = jest.fn()
const runMutationMock = jest.fn()
const mockTranslate = (key: string) => key

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: runMutationMock, retryLastMutation: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
}))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))
jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))

import { LinkDocumentDialog } from '../widgets/injection/related-documents/LinkDocumentDialog'
import { useRelatedDocuments } from '../widgets/injection/related-documents/useRelatedDocuments'

const TARGET = {
  entityType: 'customer-company' as const,
  entityId: '11111111-1111-4111-8111-111111111111',
  label: 'Acme',
  href: '/backend/customers/companies/11111111-1111-4111-8111-111111111111',
  values: { name: 'Acme' },
}
const SECOND_TARGET = {
  ...TARGET,
  entityId: '33333333-3333-4333-8333-333333333333',
  label: 'Globex',
  href: '/backend/customers/companies/33333333-3333-4333-8333-333333333333',
  values: { name: 'Globex' },
}

function documentResult(title: string) {
  return {
    ok: true,
    result: {
      items: [{
        id: '22222222-2222-4222-8222-222222222222',
        title,
        ownerLabel: 'Ada Lovelace',
        capabilities: { canEdit: true },
      }],
    },
  }
}

async function flushPromises(iterations = 4): Promise<void> {
  for (let index = 0; index < iterations; index += 1) await Promise.resolve()
}

describe('LinkDocumentDialog search freshness', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    apiCallMock.mockReset()
    runMutationMock.mockReset()
  })

  afterEach(() => { jest.useRealTimers() })

  it('removes old rows synchronously and aborts the old request when the query changes', async () => {
    let resolveBeta: ((value: unknown) => void) | null = null
    let betaSignal: AbortSignal | undefined
    apiCallMock
      .mockResolvedValueOnce(documentResult('Alpha document'))
      .mockImplementationOnce((_url: string, options?: RequestInit) => {
        betaSignal = options?.signal ?? undefined
        return new Promise((resolve) => { resolveBeta = resolve })
      })

    render(<LinkDocumentDialog open target={TARGET} onOpenChange={jest.fn()} onLinked={jest.fn()} />)
    const input = screen.getByLabelText('documents.relatedDocuments.linkDialog.searchLabel')

    fireEvent.change(input, { target: { value: 'alpha' } })
    await act(async () => {
      jest.advanceTimersByTime(250)
      await flushPromises()
    })
    expect(screen.getByText('Alpha document')).toBeTruthy()

    fireEvent.change(input, { target: { value: 'beta' } })
    expect(screen.queryByText('Alpha document')).toBeNull()
    await act(async () => {
      jest.advanceTimersByTime(250)
      await Promise.resolve()
    })
    expect(betaSignal?.aborted).toBe(false)

    fireEvent.change(input, { target: { value: 'gamma' } })
    expect(betaSignal?.aborted).toBe(true)
    await act(async () => {
      resolveBeta?.(documentResult('Stale beta document'))
      await flushPromises()
    })
    expect(screen.queryByText('Stale beta document')).toBeNull()
  })

  it('hides and blocks rows from the previous target context immediately', async () => {
    apiCallMock.mockResolvedValue(documentResult('Context document'))
    const props = { open: true, onOpenChange: jest.fn(), onLinked: jest.fn() }
    const { rerender } = render(<LinkDocumentDialog {...props} target={TARGET} />)
    const input = screen.getByLabelText('documents.relatedDocuments.linkDialog.searchLabel')

    fireEvent.change(input, { target: { value: 'context' } })
    await act(async () => {
      jest.advanceTimersByTime(250)
      await flushPromises()
    })
    const oldRow = screen.getByRole('button', { name: /Context document/ })

    rerender(<LinkDocumentDialog {...props} target={{ ...TARGET, entityId: '33333333-3333-4333-8333-333333333333' }} />)
    expect(screen.queryByText('Context document')).toBeNull()
    fireEvent.click(oldRow)
    expect(runMutationMock).not.toHaveBeenCalled()
  })

  it('clears the previous host results synchronously and aborts its in-flight reload', async () => {
    let resolveOldReload: ((value: unknown) => void) | null = null
    let resolveNewTarget: ((value: unknown) => void) | null = null
    let oldReloadSignal: AbortSignal | undefined
    let newTargetSignal: AbortSignal | undefined
    apiCallMock
      .mockResolvedValueOnce(documentResult('Acme private document'))
      .mockImplementationOnce((_url: string, options?: RequestInit) => {
        oldReloadSignal = options?.signal ?? undefined
        return new Promise((resolve) => { resolveOldReload = resolve })
      })
      .mockImplementationOnce((_url: string, options?: RequestInit) => {
        newTargetSignal = options?.signal ?? undefined
        return new Promise((resolve) => { resolveNewTarget = resolve })
      })

    const { result, rerender } = renderHook(
      ({ target }) => useRelatedDocuments(target),
      { initialProps: { target: TARGET } },
    )
    await act(async () => { await flushPromises() })
    expect(result.current.items.map((item) => item.title)).toEqual(['Acme private document'])

    act(() => { result.current.retry() })
    await act(async () => { await flushPromises() })
    expect(apiCallMock).toHaveBeenCalledTimes(2)
    expect(oldReloadSignal?.aborted).toBe(false)

    rerender({ target: SECOND_TARGET })
    await act(async () => { await flushPromises() })

    expect(oldReloadSignal?.aborted).toBe(true)
    expect(newTargetSignal?.aborted).toBe(false)
    expect(result.current.status).toBe('loading')
    expect(result.current.items).toEqual([])
    expect(result.current.capabilities).toEqual(expect.objectContaining({ canCreateDocument: false }))

    await act(async () => {
      resolveOldReload?.(documentResult('Stale Acme document'))
      await flushPromises()
    })
    expect(result.current.items).toEqual([])

    await act(async () => {
      resolveNewTarget?.(documentResult('Globex document'))
      await flushPromises()
    })
    expect(result.current.status).toBe('ready')
    expect(result.current.items.map((item) => item.title)).toEqual(['Globex document'])
  })
})
