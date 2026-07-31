/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import * as React from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { WidgetVisibilityEditor } from '../WidgetVisibilityEditor'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(),
  apiCallOrThrow: jest.fn(),
}))

const readApiMock = readApiResultOrThrow as jest.Mock

const CATALOG_URL = '/api/dashboards/widgets/catalog'
const ROLE_URL = '/api/dashboards/roles/widgets'
const USER_URL = '/api/dashboards/users/widgets'

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void }

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const catalogPayload = { items: [{ id: 'w1', title: 'Widget One', description: null }] }

describe('WidgetVisibilityEditor', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('starts the catalog and role requests in parallel', async () => {
    const requested: string[] = []
    const catalog = deferred<typeof catalogPayload>()
    const role = deferred<{ widgetIds: string[]; hasCustom: boolean; scope: { tenantId: string | null; organizationId: string | null } }>()

    readApiMock.mockImplementation((url: string) => {
      requested.push(url)
      if (url.startsWith(CATALOG_URL)) return catalog.promise
      if (url.startsWith(ROLE_URL)) return role.promise
      return Promise.resolve({})
    })

    renderWithProviders(<WidgetVisibilityEditor kind="role" targetId="role-1" />)

    // Both requests must be in flight before the catalog resolves. A serial
    // implementation only issues the role request after the catalog finishes,
    // so this assertion fails unless the two loads start together.
    await waitFor(() => {
      expect(requested.some((url) => url.startsWith(CATALOG_URL))).toBe(true)
      expect(requested.some((url) => url.startsWith(ROLE_URL))).toBe(true)
    })

    await act(async () => {
      catalog.resolve(catalogPayload)
      role.resolve({ widgetIds: ['w1'], hasCustom: true, scope: { tenantId: null, organizationId: null } })
    })

    const checkbox = await screen.findByRole('checkbox')
    expect(screen.getByText('Widget One')).toBeInTheDocument()
    expect(checkbox).toBeChecked()
  })

  it('starts the catalog and user requests in parallel', async () => {
    const requested: string[] = []
    const catalog = deferred<typeof catalogPayload>()
    const user = deferred<{
      mode: 'inherit' | 'override'
      widgetIds: string[]
      hasCustom: boolean
      effectiveWidgetIds: string[]
      scope: { tenantId: string | null; organizationId: string | null }
    }>()

    readApiMock.mockImplementation((url: string) => {
      requested.push(url)
      if (url.startsWith(CATALOG_URL)) return catalog.promise
      if (url.startsWith(USER_URL)) return user.promise
      return Promise.resolve({})
    })

    renderWithProviders(<WidgetVisibilityEditor kind="user" targetId="user-1" />)

    await waitFor(() => {
      expect(requested.some((url) => url.startsWith(CATALOG_URL))).toBe(true)
      expect(requested.some((url) => url.startsWith(USER_URL))).toBe(true)
    })

    await act(async () => {
      catalog.resolve(catalogPayload)
      user.resolve({
        mode: 'override',
        widgetIds: ['w1'],
        hasCustom: true,
        effectiveWidgetIds: ['w1'],
        scope: { tenantId: null, organizationId: null },
      })
    })

    const checkbox = await screen.findByRole('checkbox')
    expect(screen.getByText('Widget One')).toBeInTheDocument()
    expect(checkbox).toBeChecked()
  })

  it('surfaces a load error when a request fails', async () => {
    readApiMock.mockImplementation((url: string) => {
      if (url.startsWith(CATALOG_URL)) return Promise.reject(new Error('boom'))
      return Promise.resolve({ widgetIds: [], hasCustom: false, scope: { tenantId: null, organizationId: null } })
    })

    renderWithProviders(<WidgetVisibilityEditor kind="role" targetId="role-1" />)

    await waitFor(() => {
      expect(screen.getByText('Unable to load widget configuration.')).toBeInTheDocument()
    })
  })
})
