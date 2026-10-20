/** @jest-environment jsdom */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import type { LoadedInjectionWidget } from '@open-mercato/shared/modules/widgets/injection-loader'
import type { VersionHistoryEntry } from '../types'

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

import { VersionHistoryDetail } from '../VersionHistoryDetail'
import { VERSION_HISTORY_ENTRY_AFTER_INJECTION_SPOT_ID } from '../../injection/spotIds'

const ENTRY: VersionHistoryEntry = {
  id: '11111111-1111-4111-8111-111111111111',
  commandId: 'customers.deals.update',
  actionLabel: 'Update deal',
  executionState: 'done',
  actorUserId: 'user-1',
  actorUserName: 'Alice Admin',
  resourceKind: 'customers.deal',
  resourceId: 'deal-1',
  undoToken: null,
  createdAt: '2026-10-01T10:15:00.000Z',
  updatedAt: '2026-10-01T10:15:00.000Z',
  changes: null,
}

const translate = (key: string) => key

function probeWidget(): LoadedInjectionWidget {
  return {
    metadata: { id: 'test.log-cause' },
    moduleId: 'test_module',
    key: 'test.log-cause',
    Widget: ({ context }: { context: unknown }) => {
      const { logId, resourceKind, resourceId } = context as { logId: string; resourceKind: string | null; resourceId: string | null }
      return <div data-testid="log-cause-probe">{`${logId}|${resourceKind}|${resourceId}`}</div>
    },
  }
}

describe('VersionHistoryDetail entry spot', () => {
  beforeEach(() => {
    loadInjectionWidgetsForSpotMock.mockReset()
  })

  it('renders widgets registered on the entry spot with the entry context', async () => {
    loadInjectionWidgetsForSpotMock.mockResolvedValue([probeWidget()])
    render(<VersionHistoryDetail entry={ENTRY} t={translate} />)
    expect(await screen.findByTestId('log-cause-probe')).toHaveTextContent(
      '11111111-1111-4111-8111-111111111111|customers.deal|deal-1',
    )
    expect(loadInjectionWidgetsForSpotMock).toHaveBeenCalledWith(VERSION_HISTORY_ENTRY_AFTER_INJECTION_SPOT_ID)
  })

  it('leaves only a collapsed empty wrapper when no widget is registered', async () => {
    loadInjectionWidgetsForSpotMock.mockResolvedValue([])
    const { container } = render(<VersionHistoryDetail entry={{ ...ENTRY, resourceKind: null, resourceId: null }} t={translate} />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const wrapper = container.querySelector('section.empty\\:hidden') as HTMLElement
    expect(wrapper).not.toBeNull()
    expect(wrapper).toBeEmptyDOMElement()
    expect(screen.queryByTestId('log-cause-probe')).toBeNull()
  })
})
