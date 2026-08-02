/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import {
  __reload,
  AUTH_IDENTITY_STORAGE_KEY,
  AUTH_IDENTITY_USER_STORAGE_KEY,
  AuthSessionGuard,
  notifyAuthIdentityChange,
} from '../AuthSessionGuard'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

const apiCallMock = apiCall as jest.MockedFunction<typeof apiCall>

const originalReload = __reload.fn

function mockLocationReload() {
  const reloadSpy = jest.fn()
  __reload.fn = reloadSpy
  return reloadSpy
}

function restoreLocation() {
  __reload.fn = originalReload
}

function makeApiResult(payload: { status?: number; userId?: string | null }) {
  const status = payload.status ?? 200
  return {
    ok: status >= 200 && status < 300,
    status,
    result: payload.userId !== undefined ? { ok: true, granted: [], userId: payload.userId } : null,
    response: { ok: status < 400, status } as unknown as Response,
    cacheStatus: null,
  }
}

describe('AuthSessionGuard', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
  })

  afterEach(() => {
    restoreLocation()
  })

  it('reloads when the cookie identity differs from the server-rendered identity', async () => {
    const reload = mockLocationReload()
    apiCallMock.mockResolvedValue(makeApiResult({ userId: 'admin-id' }))

    render(<AuthSessionGuard serverUserId="employee-id" />)

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1)
    })
  })

  it('reloads when the cookie session has been cleared but the page still has a user', async () => {
    const reload = mockLocationReload()
    apiCallMock.mockResolvedValue(makeApiResult({ status: 401 }))

    render(<AuthSessionGuard serverUserId="employee-id" />)

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1)
    })
  })

  it('does not reload when the cookie identity still matches', async () => {
    const reload = mockLocationReload()
    apiCallMock.mockResolvedValue(makeApiResult({ userId: 'employee-id' }))

    render(<AuthSessionGuard serverUserId="employee-id" />)

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => {
      expect(apiCallMock).toHaveBeenCalled()
    })
    expect(reload).not.toHaveBeenCalled()
  })

  it('does not poll while the tab is hidden', async () => {
    mockLocationReload()
    apiCallMock.mockResolvedValue(makeApiResult({ userId: 'employee-id' }))

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    })

    render(<AuthSessionGuard serverUserId="employee-id" />)

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(apiCallMock).not.toHaveBeenCalled()

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
  })

  it('reacts to cross-tab storage broadcasts', async () => {
    const reload = mockLocationReload()
    apiCallMock.mockResolvedValue(makeApiResult({ userId: 'admin-id' }))

    render(<AuthSessionGuard serverUserId="employee-id" />)

    await act(async () => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: AUTH_IDENTITY_STORAGE_KEY,
          newValue: String(Date.now()),
        }),
      )
    })

    await waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1)
    })
  })
})

describe('notifyAuthIdentityChange', () => {
  it('writes a sentinel value to localStorage so other tabs receive a storage event', () => {
    const setItemSpy = jest.spyOn(window.localStorage.__proto__, 'setItem')
    notifyAuthIdentityChange()
    expect(setItemSpy).toHaveBeenCalledWith(AUTH_IDENTITY_STORAGE_KEY, expect.any(String))
    setItemSpy.mockRestore()
  })
})

describe('perspective purge at the rendered identity boundary (#4185)', () => {
  const snapshotKey = 'om_table_perspective_snapshot:customers-companies'

  beforeEach(() => {
    window.localStorage.clear()
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: { ok: true } } as never)
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  it('records the first observed user without discarding existing table state', () => {
    window.localStorage.setItem(snapshotKey, '{"columnWidths":{"name":240}}')

    render(<AuthSessionGuard serverUserId="user-1" />)

    expect(window.localStorage.getItem(snapshotKey)).toBe('{"columnWidths":{"name":240}}')
    expect(window.localStorage.getItem(AUTH_IDENTITY_USER_STORAGE_KEY)).toBe('user-1')
  })

  it('keeps a returning user\'s unsaved widths across a reload', () => {
    window.localStorage.setItem(AUTH_IDENTITY_USER_STORAGE_KEY, 'user-1')
    window.localStorage.setItem(snapshotKey, '{"columnWidths":{"name":240}}')

    render(<AuthSessionGuard serverUserId="user-1" />)

    expect(window.localStorage.getItem(snapshotKey)).toBe('{"columnWidths":{"name":240}}')
  })

  it('purges perspective state when the backend renders for a different user', () => {
    window.localStorage.setItem(AUTH_IDENTITY_USER_STORAGE_KEY, 'user-1')
    window.localStorage.setItem(snapshotKey, '{"columnWidths":{"name":240}}')

    render(<AuthSessionGuard serverUserId="user-2" />)

    expect(window.localStorage.getItem(snapshotKey)).toBeNull()
    expect(window.localStorage.getItem(AUTH_IDENTITY_USER_STORAGE_KEY)).toBe('user-2')
  })

  it('does nothing when the shell renders without an authenticated user', () => {
    window.localStorage.setItem(AUTH_IDENTITY_USER_STORAGE_KEY, 'user-1')
    window.localStorage.setItem(snapshotKey, '{"columnWidths":{"name":240}}')

    render(<AuthSessionGuard serverUserId={null} />)

    expect(window.localStorage.getItem(snapshotKey)).toBe('{"columnWidths":{"name":240}}')
    expect(window.localStorage.getItem(AUTH_IDENTITY_USER_STORAGE_KEY)).toBe('user-1')
  })
})
