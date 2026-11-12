/** @jest-environment node */
const enqueue = jest.fn(async () => 'queued-1')
const createJob = jest.fn(async () => ({ id: 'progress-job-1' }))
let progressEnabled = true

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'progressService' && progressEnabled) return { createJob }
    throw new Error(`[internal] Could not resolve ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
    t: (key: string, fallback?: string) => fallback ?? key,
  })),
}))

jest.mock('../lib/time-tracking/reapplyRounding', () => {
  const actual = jest.requireActual('../lib/time-tracking/reapplyRounding')
  return { ...actual, getStaffQueue: jest.fn(() => ({ enqueue })) }
})

import commands from '../cli'

const recalculate = commands.find((command) => command.command === 'timesheets:recalculate')!
const tenantId = '11111111-1111-4111-8111-111111111111'

describe('mercato staff timesheets:recalculate', () => {
  beforeEach(() => {
    progressEnabled = true
    enqueue.mockClear()
    createJob.mockClear()
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('enqueues the recalculation under a progress job', async () => {
    await recalculate.run(['--tenant', tenantId])

    expect(createJob).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ progressJobId: 'progress-job-1', scope: { tenantId, organizationIds: null, userId: null } }),
    )
  })

  it('enqueues the recalculation without a progress job when the progress module is disabled', async () => {
    progressEnabled = false

    await recalculate.run(['--tenant', tenantId])

    expect(createJob).not.toHaveBeenCalled()
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ progressJobId: null, scope: { tenantId, organizationIds: null, userId: null } }),
    )
  })
})
