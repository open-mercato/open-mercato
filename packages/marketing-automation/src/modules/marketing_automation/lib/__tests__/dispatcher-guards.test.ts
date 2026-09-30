const isErasedSubject = jest.fn()
const hasActiveRun = jest.fn()
const countRunsStartedSince = jest.fn()
const hasRecentRun = jest.fn()

jest.mock('../gdpr.js', () => ({ isErasedSubject: (...a: unknown[]) => isErasedSubject(...a) }))
jest.mock('../runs.js', () => ({
  hasActiveRun: (...a: unknown[]) => hasActiveRun(...a),
  countRunsStartedSince: (...a: unknown[]) => countRunsStartedSince(...a),
  hasRecentRun: (...a: unknown[]) => hasRecentRun(...a),
}))

import { MAX_RUNS_PER_SUBJECT, RUN_BUDGET_WINDOW_MINUTES, subjectGuardsAllow } from '../dispatcher'
import type { MarketingCampaign } from '../../data/entities'

/**
 * The four questions asked before a customer is enrolled, and the order they are asked in.
 *
 * `lib/dispatcher.ts` is the largest file in the module and had no unit test at all — it was covered only by
 * integration specs, which exercise the happy path and cannot easily construct the states these guards exist
 * for. Each one refuses a real and different thing, and getting the ORDER wrong is not a style question:
 * erasure has to come first, because every guard after it reads data about somebody who asked to be forgotten.
 *
 * Every guard here reads a customer ID and nothing else, which is what lets the sweep ask them BEFORE paying
 * eleven queries to describe the person.
 */
const campaign = { id: 'camp-1', name: 'Test' } as unknown as MarketingCampaign
const now = new Date('2026-09-30T12:00:00.000Z')
const deps = {
  em: {} as never,
  container: {} as never,
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } as never,
  now,
  scope: { tenantId: 't1', organizationId: 'o1' },
  enqueueResume: jest.fn(),
} as never

const unlimited = { kind: 'unlimited' } as const

beforeEach(() => {
  for (const fn of [isErasedSubject, hasActiveRun, countRunsStartedSince, hasRecentRun]) fn.mockReset()
  isErasedSubject.mockResolvedValue(false)
  hasActiveRun.mockResolvedValue(false)
  countRunsStartedSince.mockResolvedValue(0)
  hasRecentRun.mockResolvedValue(false)
})

describe('subjectGuardsAllow', () => {
  it('lets an ordinary customer through', async () => {
    await expect(subjectGuardsAllow(campaign, 'cust-1', unlimited, deps)).resolves.toBe(true)
  })

  it('refuses somebody who asked to be forgotten, before asking anything else', async () => {
    isErasedSubject.mockResolvedValue(true)
    await expect(subjectGuardsAllow(campaign, 'cust-1', unlimited, deps)).resolves.toBe(false)
    /**
     * Not merely refused — refused FIRST.
     *
     * Erasure unlinks their runs, sends and points. Every guard after this one reads those tables, and a new
     * run would simply start writing them again for a birthday or a reorder reminder that still names their
     * customer id.
     */
    expect(hasActiveRun).not.toHaveBeenCalled()
    expect(countRunsStartedSince).not.toHaveBeenCalled()
    expect(hasRecentRun).not.toHaveBeenCalled()
  })

  it('refuses somebody already mid-journey in this campaign', async () => {
    // A second concurrent entry would double every remaining step.
    hasActiveRun.mockResolvedValue(true)
    await expect(subjectGuardsAllow(campaign, 'cust-1', unlimited, deps)).resolves.toBe(false)
    expect(countRunsStartedSince).not.toHaveBeenCalled()
  })

  describe('the dispatch budget', () => {
    it('refuses at the ceiling, not above it', async () => {
      countRunsStartedSince.mockResolvedValue(MAX_RUNS_PER_SUBJECT)
      await expect(subjectGuardsAllow(campaign, 'cust-1', unlimited, deps)).resolves.toBe(false)
    })

    it('allows one below it', async () => {
      countRunsStartedSince.mockResolvedValue(MAX_RUNS_PER_SUBJECT - 1)
      await expect(subjectGuardsAllow(campaign, 'cust-1', unlimited, deps)).resolves.toBe(true)
    })

    it('counts over the stated window, across every campaign', async () => {
      /**
       * The budget exists because campaigns can drive each other: `add_tag` emits
       * `customers.tag.assigned`, which is itself a trigger. An in-payload depth counter cannot see that,
       * because the events are emitted by the modules that own them. A budget the database can answer does,
       * and it bounds any cycle however many campaigns are in it — which is why it is counted per SUBJECT
       * and not per campaign.
       */
      await subjectGuardsAllow(campaign, 'cust-1', unlimited, deps)
      const [, subjectEntityId, , since] = countRunsStartedSince.mock.calls[0]
      expect(subjectEntityId).toBe('cust-1')
      expect(since).toEqual(new Date(now.getTime() - RUN_BUDGET_WINDOW_MINUTES * 60_000))
    })
  })

  describe('the re-entry policy', () => {
    it('asks nothing extra when re-entry is unlimited', async () => {
      await subjectGuardsAllow(campaign, 'cust-1', unlimited, deps)
      expect(hasRecentRun).not.toHaveBeenCalled()
    })

    it('asks about ANY previous run under a once policy', async () => {
      await subjectGuardsAllow(campaign, 'cust-1', { kind: 'once' }, deps)
      // `since = null` means "ever", which is what once means.
      expect(hasRecentRun.mock.calls[0][4]).toBeNull()
    })

    it('asks about the cooldown window under a cooldown policy', async () => {
      await subjectGuardsAllow(campaign, 'cust-1', { kind: 'cooldown', afterDays: 30 }, deps)
      expect(hasRecentRun.mock.calls[0][4]).toEqual(new Date(now.getTime() - 30 * 86_400_000))
    })

    it('refuses when the policy says they have been here recently', async () => {
      hasRecentRun.mockResolvedValue(true)
      await expect(subjectGuardsAllow(campaign, 'cust-1', { kind: 'once' }, deps)).resolves.toBe(false)
    })
  })
})
