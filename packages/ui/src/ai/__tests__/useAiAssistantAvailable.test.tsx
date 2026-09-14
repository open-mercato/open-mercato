/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import type { BackendChromePayload } from '@open-mercato/shared/modules/navigation/backendChrome'
import { useBackendChrome } from '../../backend/BackendChromeProvider'
import { getEnabledModuleIds } from '@open-mercato/shared/modules/widgets/injection-loader'
import { useAiAssistantAvailable } from '../useAiAssistantAvailable'

jest.mock('../../backend/BackendChromeProvider', () => ({
  useBackendChrome: jest.fn(),
}))

jest.mock('@open-mercato/shared/modules/widgets/injection-loader', () => ({
  getEnabledModuleIds: jest.fn(),
  subscribeToInjectionRegistryChanges: () => () => {},
}))

const useBackendChromeMock = useBackendChrome as jest.MockedFunction<typeof useBackendChrome>
const getEnabledModuleIdsMock = getEnabledModuleIds as jest.MockedFunction<typeof getEnabledModuleIds>

function Probe() {
  const available = useAiAssistantAvailable()
  return <span data-testid="available">{String(available)}</span>
}

function setChrome(grantedFeatures: string[] | null) {
  useBackendChromeMock.mockReturnValue({
    payload: grantedFeatures === null
      ? null
      : ({ grantedFeatures } as unknown as BackendChromePayload),
    isLoading: false,
    isReady: true,
    refresh: async () => {},
  })
}

function renderProbe(): string | null {
  render(<Probe />)
  return screen.getByTestId('available').textContent
}

describe('useAiAssistantAvailable', () => {
  beforeEach(() => {
    useBackendChromeMock.mockReset()
    getEnabledModuleIdsMock.mockReset()
  })

  it('is true when the module is enabled and the feature is granted', () => {
    getEnabledModuleIdsMock.mockReturnValue(new Set(['auth', 'ai_assistant']))
    setChrome(['auth.users.view', 'ai_assistant.view'])

    expect(renderProbe()).toBe('true')
  })

  it('is false when the module is absent from the enabled registry', () => {
    getEnabledModuleIdsMock.mockReturnValue(new Set(['auth', 'customers']))
    setChrome(['auth.users.view', 'ai_assistant.view'])

    expect(renderProbe()).toBe('false')
  })

  it('is false when the feature is not granted', () => {
    getEnabledModuleIdsMock.mockReturnValue(new Set(['auth', 'ai_assistant']))
    setChrome(['auth.users.view'])

    expect(renderProbe()).toBe('false')
  })

  it('is false while the backend chrome payload has not arrived', () => {
    getEnabledModuleIdsMock.mockReturnValue(new Set(['auth', 'ai_assistant']))
    setChrome(null)

    expect(renderProbe()).toBe('false')
  })

  it('treats an unregistered module set as "not known yet" rather than disabled', () => {
    // `registerEnabledModuleIds` runs from an async client-bootstrap import, so
    // `null` here means the registry has not landed — not that the module is off.
    getEnabledModuleIdsMock.mockReturnValue(null)
    setChrome(['ai_assistant.view'])

    expect(renderProbe()).toBe('true')
  })

  it('matches a module wildcard grant', () => {
    // Superadmins carry `<module>.*`, expanded server-side for enabled modules
    // only. A plain `includes()` would miss it.
    getEnabledModuleIdsMock.mockReturnValue(new Set(['ai_assistant']))
    setChrome(['ai_assistant.*'])

    expect(renderProbe()).toBe('true')
  })
})
