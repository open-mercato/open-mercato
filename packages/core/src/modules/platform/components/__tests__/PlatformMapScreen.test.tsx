/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { PlatformMapScreen } from '../PlatformMapScreen'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/backend/platform/map',
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/ui/backend/injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false }),
}))

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as typeof ResizeObserver
})

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn().mockResolvedValue({
    schemaVersion: 1,
    generatedAt: '2026-06-29T00:00:00.000Z',
    scope: null,
    surfaces: {
      event: {
        tier: 1,
        rows: [{ id: 'example.todo.created', label: 'Created', category: 'crud', entity: 'todo', clientBroadcast: false, portalBroadcast: false }],
      },
    },
  }),
}))

describe('PlatformMapScreen', () => {
  it('renders surface switcher and finishes loading', async () => {
    renderWithProviders(<PlatformMapScreen />)
    expect(await screen.findByLabelText(/Surface/i)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText(/Loading platform map/i)).not.toBeInTheDocument()
    })
    expect(screen.queryByText(/Failed to load platform map/i)).not.toBeInTheDocument()
  })
})
