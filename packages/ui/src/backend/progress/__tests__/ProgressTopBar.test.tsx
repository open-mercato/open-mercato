/** @jest-environment jsdom */

import * as React from 'react'
import { render } from '@testing-library/react'

import type { ProgressJobDto, UseProgressPollResult } from '../useProgressPoll'

const mockUseProgress = jest.fn<UseProgressPollResult, []>()
const mockUseBackendChrome = jest.fn<{ payload: { grantedFeatures: string[] } | null }, []>()

jest.mock('../useProgress', () => ({
  useProgress: () => mockUseProgress(),
}))

jest.mock('../../BackendChromeProvider', () => ({
  useBackendChrome: () => mockUseBackendChrome(),
}))

// Real auto-hide hook keeps completed jobs visible for this test.
jest.mock('../useAutoHideCompletedJobs', () => ({
  useAutoHideCompletedJobs: (jobs: ProgressJobDto[]) => jobs,
}))

import { ProgressTopBar } from '../ProgressTopBar'

const activeJob: ProgressJobDto = {
  id: 'job-1',
  name: 'Bulk update',
  status: 'running',
  processedCount: 3,
  totalCount: 10,
  progressPercent: 30,
} as unknown as ProgressJobDto

const translate = ((key: string, fallback?: string) => fallback ?? key) as never

function progressResult(overrides: Partial<UseProgressPollResult> = {}): UseProgressPollResult {
  return {
    activeJobs: [activeJob],
    recentlyCompleted: [],
    isLoading: false,
    error: null,
    refresh: () => {},
    ...overrides,
  } as UseProgressPollResult
}

describe('ProgressTopBar progress.view gating', () => {
  beforeEach(() => {
    mockUseProgress.mockReset()
    mockUseBackendChrome.mockReset()
    mockUseProgress.mockReturnValue(progressResult())
  })

  it('renders nothing and never subscribes to progress reads when progress.view is not granted', () => {
    mockUseBackendChrome.mockReturnValue({ payload: { grantedFeatures: ['configs.manage'] } })
    const { container } = render(<ProgressTopBar t={translate} />)
    expect(container.firstChild).toBeNull()
    // useProgress fires `/api/progress/active`; it must not run without the feature.
    expect(mockUseProgress).not.toHaveBeenCalled()
  })

  it('renders nothing when the chrome payload has no granted features yet', () => {
    mockUseBackendChrome.mockReturnValue({ payload: null })
    const { container } = render(<ProgressTopBar t={translate} />)
    expect(container.firstChild).toBeNull()
    expect(mockUseProgress).not.toHaveBeenCalled()
  })

  it('renders the bar and subscribes to progress reads when progress.view is granted', () => {
    mockUseBackendChrome.mockReturnValue({ payload: { grantedFeatures: ['progress.view'] } })
    const { container } = render(<ProgressTopBar t={translate} />)
    expect(mockUseProgress).toHaveBeenCalled()
    expect(container.textContent).toContain('Bulk update')
  })

  it('honors wildcard grants such as progress.* for the read gate', () => {
    mockUseBackendChrome.mockReturnValue({ payload: { grantedFeatures: ['progress.*'] } })
    const { container } = render(<ProgressTopBar t={translate} />)
    expect(mockUseProgress).toHaveBeenCalled()
    expect(container.textContent).toContain('Bulk update')
  })
})
