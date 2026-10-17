/** @jest-environment jsdom */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import type { LoadedInjectionWidget } from '@open-mercato/shared/modules/widgets/injection-loader'

const loadInjectionWidgetsForSpotMock = jest.fn()

jest.mock('@open-mercato/shared/modules/widgets/injection-loader', () => ({
  getInjectionRegistryVersion: () => 0,
  subscribeToInjectionRegistryChanges: () => () => {},
  loadInjectionWidgetsForSpot: (...args: unknown[]) => loadInjectionWidgetsForSpotMock(...args),
}))

jest.mock('../../BackendChromeProvider', () => ({
  useBackendChrome: () => ({
    payload: { grantedFeatures: [] },
    isLoading: false,
    isReady: true,
    refresh: jest.fn(),
  }),
}))

import { AccessDeniedMessage } from '../AccessDeniedMessage'
import { BACKEND_ACCESS_DENIED_AFTER_INJECTION_SPOT_ID } from '../../injection/spotIds'

function contextProbeWidget(): LoadedInjectionWidget {
  return {
    metadata: { id: 'test.access-why' },
    moduleId: 'test_module',
    key: 'test.access-why',
    Widget: ({ context }: { context: unknown }) => {
      const { path, requiredFeatures } = context as { path: string | null; requiredFeatures: string[] }
      return <div data-testid="access-why-probe">{`${path}|${requiredFeatures.join(',')}`}</div>
    },
  }
}

describe('AccessDeniedMessage', () => {
  beforeEach(() => {
    loadInjectionWidgetsForSpotMock.mockReset()
  })

  it('renders the message without an injection spot when no access context is given', () => {
    const { container } = render(<AccessDeniedMessage label="Access Denied" description="No permission" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Access Denied')
    expect(container.firstElementChild).toBe(screen.getByRole('alert'))
    expect(loadInjectionWidgetsForSpotMock).not.toHaveBeenCalled()
  })

  it('renders nothing extra when no widget is registered for the access-denied spot', async () => {
    loadInjectionWidgetsForSpotMock.mockResolvedValue([])
    render(<AccessDeniedMessage label="Access Denied" path="/backend/sales/orders" requiredFeatures={['sales.orders.view']} />)
    await screen.findByRole('alert')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(loadInjectionWidgetsForSpotMock).toHaveBeenCalledWith(BACKEND_ACCESS_DENIED_AFTER_INJECTION_SPOT_ID)
    expect(screen.queryByTestId('access-why-probe')).toBeNull()
  })

  it('passes path and required features to widgets on the access-denied spot', async () => {
    loadInjectionWidgetsForSpotMock.mockResolvedValue([contextProbeWidget()])
    render(
      <AccessDeniedMessage
        label="Access Denied"
        path="/backend/sales/orders"
        requiredFeatures={['sales.orders.view', 'sales.orders.manage']}
      />,
    )
    expect(await screen.findByTestId('access-why-probe')).toHaveTextContent(
      '/backend/sales/orders|sales.orders.view,sales.orders.manage',
    )
  })
})
