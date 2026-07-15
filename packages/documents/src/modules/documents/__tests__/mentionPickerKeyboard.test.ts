/** @jest-environment jsdom */

import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'

const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => key,
}))

import {
  buildMentionPrincipalUrl,
  MentionPicker,
  nextMentionIndex,
  readMentionUserItems,
} from '../backend/documents/[id]/MentionPicker'

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'
const SECOND_USER_ID = '33333333-3333-4333-8333-333333333333'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

describe('mention picker keyboard navigation', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    apiCallMock.mockReset()
  })

  afterEach(() => jest.useRealTimers())

  it('selects the first/last option from an empty active state', () => {
    expect(nextMentionIndex(-1, 1, 3)).toBe(0)
    expect(nextMentionIndex(-1, -1, 3)).toBe(2)
  })

  it('keeps navigation within the bounded result page', () => {
    expect(nextMentionIndex(0, -1, 3)).toBe(0)
    expect(nextMentionIndex(2, 1, 3)).toBe(2)
    expect(nextMentionIndex(1, 1, 3)).toBe(2)
    expect(nextMentionIndex(0, 1, 0)).toBe(-1)
  })

  it('uses the document-scoped mention endpoint instead of an Auth administration route', () => {
    expect(buildMentionPrincipalUrl(DOCUMENT_ID, 'Ada Lovelace')).toBe(
      `/api/documents/${DOCUMENT_ID}/principals?mode=mention&type=user&search=Ada+Lovelace&page=1&pageSize=8`,
    )
  })

  it('normalizes only minimal endpoint fields and replaces embedded UUID labels', () => {
    expect(readMentionUserItems({
      items: [{
        id: USER_ID,
        label: `Agent ${USER_ID}`,
        secondary: `${USER_ID}@example.test`,
        passwordHash: 'ignored',
      }],
    }, 'Unknown user')).toEqual([{ id: USER_ID, label: 'Unknown user', secondary: null }])
  })

  it('waits for the encrypted-search minimum and synchronously hides stale options when disabled', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      result: { items: [{ id: USER_ID, label: 'Ada Lovelace', secondary: 'ada@example.test' }] },
    })
    const onPick = jest.fn()
    const view = render(React.createElement(MentionPicker, { documentId: DOCUMENT_ID, onPick }))
    const input = screen.getByRole('combobox')

    fireEvent.change(input, { target: { value: 'ab' } })
    await act(async () => {
      jest.advanceTimersByTime(500)
      await Promise.resolve()
    })
    expect(apiCallMock).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: 'Ada' } })
    await act(async () => {
      jest.advanceTimersByTime(250)
      for (let index = 0; index < 4; index += 1) await Promise.resolve()
    })
    expect(screen.getByRole('option', { name: /Ada Lovelace/ })).not.toBeNull()

    view.rerender(React.createElement(MentionPicker, { documentId: DOCUMENT_ID, onPick, disabled: true }))
    expect(screen.queryByRole('option')).toBeNull()
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    expect(onPick).not.toHaveBeenCalled()
  })

  it('invalidates a visible result synchronously when the query changes before Enter can select it', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      result: { items: [{ id: USER_ID, label: 'Ada Lovelace', secondary: 'ada@example.test' }] },
    })
    const onPick = jest.fn()
    render(React.createElement(MentionPicker, { documentId: DOCUMENT_ID, onPick }))
    const input = screen.getByRole('combobox')

    fireEvent.change(input, { target: { value: 'Ada' } })
    await act(async () => {
      jest.advanceTimersByTime(250)
      for (let index = 0; index < 4; index += 1) await Promise.resolve()
    })
    expect(screen.getByRole('option', { name: /Ada Lovelace/ })).not.toBeNull()

    fireEvent.change(input, { target: { value: 'Grace' } })
    expect(screen.queryByRole('option')).toBeNull()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).not.toHaveBeenCalled()
  })

  it('ignores an aborted older response and binds mouse and keyboard selection to the exact query', async () => {
    const ada = deferred<{ ok: true; result: { items: Array<{ id: string; label: string }> } }>()
    const grace = deferred<{ ok: true; result: { items: Array<{ id: string; label: string }> } }>()
    apiCallMock
      .mockReturnValueOnce(ada.promise)
      .mockReturnValueOnce(grace.promise)
    const onPick = jest.fn()
    render(React.createElement(MentionPicker, { documentId: DOCUMENT_ID, onPick }))
    const input = screen.getByRole('combobox')

    fireEvent.change(input, { target: { value: 'Ada' } })
    await act(async () => { jest.advanceTimersByTime(250) })
    const firstSignal = apiCallMock.mock.calls[0]?.[1]?.signal as AbortSignal
    expect(firstSignal.aborted).toBe(false)

    fireEvent.change(input, { target: { value: 'Grace' } })
    expect(firstSignal.aborted).toBe(true)
    await act(async () => { jest.advanceTimersByTime(250) })

    await act(async () => {
      grace.resolve({
        ok: true,
        result: { items: [{ id: SECOND_USER_ID, label: 'Grace Hopper' }] },
      })
      for (let index = 0; index < 4; index += 1) await Promise.resolve()
    })
    expect(screen.getByRole('option', { name: /Grace Hopper/ })).not.toBeNull()

    await act(async () => {
      ada.resolve({
        ok: true,
        result: { items: [{ id: USER_ID, label: 'Ada Lovelace' }] },
      })
      for (let index = 0; index < 4; index += 1) await Promise.resolve()
    })
    expect(screen.queryByRole('option', { name: /Ada Lovelace/ })).toBeNull()
    fireEvent.click(screen.getByRole('option', { name: /Grace Hopper/ }))
    expect(onPick).toHaveBeenCalledWith({ id: SECOND_USER_ID, name: 'Grace Hopper' })
  })

  it('keeps retryable search failures interactive and retries the current query', async () => {
    apiCallMock
      .mockResolvedValueOnce({ ok: false, status: 503, result: { error: 'unavailable' } })
      .mockResolvedValueOnce({
        ok: true,
        result: { items: [{ id: USER_ID, label: 'Ada Lovelace' }] },
      })
    render(React.createElement(MentionPicker, { documentId: DOCUMENT_ID, onPick: jest.fn() }))
    const input = screen.getByRole('combobox')

    fireEvent.change(input, { target: { value: 'Ada' } })
    await act(async () => {
      jest.advanceTimersByTime(250)
      for (let index = 0; index < 4; index += 1) await Promise.resolve()
    })

    expect((input as HTMLInputElement).disabled).toBe(false)
    expect(screen.getByRole('alert').textContent).toContain('Error search')
    const retry = screen.getByRole('button', { name: 'documents.actions.retry' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(retry.closest('[role="listbox"]')).toBeNull()
    fireEvent.click(retry)
    await act(async () => {
      jest.advanceTimersByTime(250)
      for (let index = 0; index < 4; index += 1) await Promise.resolve()
    })

    const option = screen.getByRole('option', { name: /Ada Lovelace/ })
    expect(option).not.toBeNull()
    expect(screen.getByRole('listbox').contains(option)).toBe(true)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('treats authorization failures as terminal unavailability', async () => {
    apiCallMock.mockResolvedValue({ ok: false, status: 403, result: { error: 'forbidden' } })
    render(React.createElement(MentionPicker, { documentId: DOCUMENT_ID, onPick: jest.fn() }))

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Ada' } })
    await act(async () => {
      jest.advanceTimersByTime(250)
      for (let index = 0; index < 4; index += 1) await Promise.resolve()
    })

    expect(screen.getByText('documents.mentions.unavailable')).toBeTruthy()
    expect((screen.getByRole('combobox') as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'documents.actions.retry' })).toBeNull()
  })
})
