/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useVersionHistory } from '../version-history/useVersionHistory'
import type { VersionHistoryConfig, VersionHistoryEntry } from '../version-history/types'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

const PAGE_SIZE = 20
const NEWEST_TIMESTAMP = Date.parse('2026-01-01T12:00:00.000Z')

const config: VersionHistoryConfig = {
  resourceKind: 'customers.person',
  resourceId: 'person-1',
}

function buildEntry(index: number): VersionHistoryEntry {
  const createdAt = new Date(NEWEST_TIMESTAMP - index * 1000).toISOString()
  return {
    id: `log-${index}`,
    commandId: 'customers.people.update',
    actionLabel: 'Update person',
    executionState: 'done',
    actorUserId: null,
    actorUserName: null,
    resourceKind: 'customers.person',
    resourceId: 'person-1',
    undoToken: null,
    createdAt,
    updatedAt: createdAt,
  }
}

function buildEntries(start: number, count: number): VersionHistoryEntry[] {
  return Array.from({ length: count }, (_unused, offset) => buildEntry(start + offset))
}

function requestedParams(callIndex: number): URLSearchParams {
  const url = (apiCall as jest.Mock).mock.calls[callIndex][0] as string
  return new URLSearchParams(url.slice(url.indexOf('?') + 1))
}

function Probe() {
  const history = useVersionHistory(config, true)

  return (
    <div>
      <div data-testid="loading">{history.isLoading ? 'yes' : 'no'}</div>
      <div data-testid="count">{history.entries.length}</div>
      <div data-testid="has-more">{history.hasMore ? 'yes' : 'no'}</div>
      <div data-testid="last-id">{history.entries[history.entries.length - 1]?.id ?? ''}</div>
      <button type="button" onClick={history.loadMore}>load more</button>
    </div>
  )
}

async function waitForCount(expected: number) {
  await waitFor(() => {
    expect(screen.getByTestId('loading').textContent).toBe('no')
    expect(screen.getByTestId('count').textContent).toBe(String(expected))
  })
}

describe('useVersionHistory', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('pages older entries with the before cursor until a short page arrives', async () => {
    ;(apiCall as jest.Mock)
      .mockResolvedValueOnce({ ok: true, status: 200, result: { items: buildEntries(0, PAGE_SIZE) } })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        result: { items: [buildEntry(PAGE_SIZE - 1), ...buildEntries(PAGE_SIZE, 5)] },
      })

    render(<Probe />)

    await waitForCount(PAGE_SIZE)
    expect(screen.getByTestId('has-more').textContent).toBe('yes')
    const firstParams = requestedParams(0)
    expect(firstParams.get('limit')).toBe(String(PAGE_SIZE))
    expect(firstParams.get('resourceKind')).toBe('customers.person')
    expect(firstParams.get('resourceId')).toBe('person-1')
    expect(firstParams.get('includeRelated')).toBe('true')
    expect(firstParams.has('before')).toBe(false)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'load more' }))
    })

    await waitForCount(PAGE_SIZE + 5)
    expect(apiCall).toHaveBeenCalledTimes(2)
    const secondParams = requestedParams(1)
    expect(secondParams.get('limit')).toBe(String(PAGE_SIZE))
    expect(secondParams.get('before')).toBe(buildEntry(PAGE_SIZE - 1).createdAt)
    expect(screen.getByTestId('last-id').textContent).toBe(`log-${PAGE_SIZE + 4}`)
    expect(screen.getByTestId('has-more').textContent).toBe('no')
  })

  it('stops offering more entries when the first page is short', async () => {
    ;(apiCall as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200, result: { items: buildEntries(0, 3) } })

    render(<Probe />)

    await waitForCount(3)
    expect(screen.getByTestId('has-more').textContent).toBe('no')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'load more' }))
    })
    expect(apiCall).toHaveBeenCalledTimes(1)
  })
})
