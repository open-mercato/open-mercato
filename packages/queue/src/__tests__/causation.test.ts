import {
  CAUSATION_META_KEY,
  INVALID_CAUSATION_REF,
  MISSING_CAUSATION_REF,
  attachCausationMetadata,
  readJobCausation,
  runJobInCausation,
} from '../causation'
import {
  getAmbientCausation,
  reportCausationDegradation,
  runWithCausation,
  type CausationEnvelope,
} from '@open-mercato/shared/lib/causation/server'

jest.mock('@open-mercato/shared/lib/causation/server', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/causation/server'),
  reportCausationDegradation: jest.fn(),
}))

const reportDegradation = reportCausationDegradation as jest.MockedFunction<typeof reportCausationDegradation>
const QUEUE_NAME = 'events'

const ENQUEUER: CausationEnvelope = {
  correlationId: '11111111-1111-4111-8111-111111111111',
  frames: [{ kind: 'user' }, { kind: 'workflow', id: 'instance-1', ref: 'step-1' }],
  causedByLogId: '22222222-2222-4222-8222-222222222222',
}

const POLLER: CausationEnvelope = {
  correlationId: '33333333-3333-4333-8333-333333333333',
  frames: [{ kind: 'system', id: 'poller' }],
}

const FORGED: CausationEnvelope = {
  correlationId: '44444444-4444-4444-8444-444444444444',
  frames: [{ kind: 'business_rule', id: 'forged-rule' }],
}

describe('queue causation metadata', () => {
  const previousFlag = process.env.OM_CAUSATION

  beforeEach(() => {
    delete process.env.OM_CAUSATION
    reportDegradation.mockClear()
  })

  afterAll(() => {
    if (previousFlag === undefined) delete process.env.OM_CAUSATION
    else process.env.OM_CAUSATION = previousFlag
  })

  describe('attachCausationMetadata', () => {
    it('attaches the ambient envelope next to existing metadata without mutating the input', () => {
      const input = { _trace: { traceparent: 'carrier' } }
      const attached = runWithCausation(ENQUEUER, () => attachCausationMetadata(input))
      expect(attached).toEqual({ _trace: { traceparent: 'carrier' }, [CAUSATION_META_KEY]: ENQUEUER })
      expect(input).toEqual({ _trace: { traceparent: 'carrier' } })
    })

    it('creates metadata when there was none', () => {
      const attached = runWithCausation(ENQUEUER, () => attachCausationMetadata(undefined))
      expect(attached).toEqual({ [CAUSATION_META_KEY]: ENQUEUER })
    })

    it('always overwrites a caller-supplied _causation with the ambient envelope', () => {
      const attached = runWithCausation(ENQUEUER, () =>
        attachCausationMetadata({ [CAUSATION_META_KEY]: FORGED, other: 1 }),
      )
      expect(attached).toEqual({ [CAUSATION_META_KEY]: ENQUEUER, other: 1 })
    })

    it('removes a caller-supplied _causation when there is no ambient envelope', () => {
      expect(getAmbientCausation()).toBeNull()
      expect(attachCausationMetadata({ [CAUSATION_META_KEY]: FORGED, other: 1 })).toEqual({ other: 1 })
      expect(attachCausationMetadata({ [CAUSATION_META_KEY]: FORGED })).toBeUndefined()
    })

    it('returns metadata untouched when there is nothing to attach or remove', () => {
      const input = { _trace: { traceparent: 'carrier' } }
      expect(attachCausationMetadata(input)).toBe(input)
      expect(attachCausationMetadata(undefined)).toBeUndefined()
    })

    it('attaches nothing and strips a caller-supplied _causation when the kill switch is off', () => {
      process.env.OM_CAUSATION = 'off'
      const attached = runWithCausation(ENQUEUER, () =>
        attachCausationMetadata({ [CAUSATION_META_KEY]: FORGED, other: 1 }),
      )
      expect(attached).toEqual({ other: 1 })
      expect(runWithCausation(ENQUEUER, () => attachCausationMetadata(undefined))).toBeUndefined()
    })
  })

  describe('readJobCausation', () => {
    it('sanitizes the stored envelope and rejects garbage', () => {
      expect(readJobCausation({ [CAUSATION_META_KEY]: ENQUEUER })).toEqual(ENQUEUER)
      expect(readJobCausation({ [CAUSATION_META_KEY]: { frames: [{ kind: 'user' }] } })).toBeNull()
      expect(readJobCausation({ [CAUSATION_META_KEY]: 'not-an-envelope' })).toBeNull()
      expect(readJobCausation(undefined)).toBeNull()
    })
  })

  describe('runJobInCausation', () => {
    it('restores the stored envelope instead of the poller context without reporting degradation', () => {
      const seen = runWithCausation(POLLER, () =>
        runJobInCausation(QUEUE_NAME, { [CAUSATION_META_KEY]: ENQUEUER }, () => getAmbientCausation()),
      )
      expect(seen).toEqual(ENQUEUER)
      expect(reportDegradation).not.toHaveBeenCalled()
    })

    it('runs a job without causation under a marked unknown entry, never the poller context', () => {
      const seen = runWithCausation(POLLER, () =>
        runJobInCausation(QUEUE_NAME, undefined, () => getAmbientCausation()),
      )
      expect(seen?.frames).toEqual([{ kind: 'unknown', ref: MISSING_CAUSATION_REF }])
      expect(seen?.correlationId).not.toBe(POLLER.correlationId)
      expect(seen?.causedByLogId).toBeUndefined()
    })

    it('reports a missing envelope, including metadata without a _causation key or with a null one', () => {
      runJobInCausation(QUEUE_NAME, undefined, () => undefined)
      runJobInCausation(QUEUE_NAME, { _trace: { traceparent: 'carrier' } }, () => undefined)
      const seen = runJobInCausation(QUEUE_NAME, { [CAUSATION_META_KEY]: null }, () => getAmbientCausation())
      expect(seen?.frames).toEqual([{ kind: 'unknown', ref: MISSING_CAUSATION_REF }])
      expect(reportDegradation).toHaveBeenCalledTimes(3)
      for (const call of reportDegradation.mock.calls) {
        expect(call).toEqual(['queue_missing_envelope', { queue: QUEUE_NAME }])
      }
    })

    it('runs a job with an invalid stored envelope under a distinct marked unknown entry and reports it', () => {
      const seen = runWithCausation(POLLER, () =>
        runJobInCausation(
          QUEUE_NAME,
          { [CAUSATION_META_KEY]: { correlationId: 'x', frames: [] } },
          () => getAmbientCausation(),
        ),
      )
      expect(seen?.frames).toEqual([{ kind: 'unknown', ref: INVALID_CAUSATION_REF }])
      expect(seen?.correlationId).not.toBe(POLLER.correlationId)
      expect(reportDegradation).toHaveBeenCalledTimes(1)
      expect(reportDegradation).toHaveBeenCalledWith('queue_invalid_envelope', { queue: QUEUE_NAME })
    })

    it('treats a stored envelope whose innermost frame is unknown garbage as invalid', () => {
      const seen = runJobInCausation(
        QUEUE_NAME,
        { [CAUSATION_META_KEY]: { correlationId: ENQUEUER.correlationId, frames: [{ kind: 'user' }, { kind: 'forged' }] } },
        () => getAmbientCausation(),
      )
      expect(seen?.frames).toEqual([{ kind: 'unknown', ref: INVALID_CAUSATION_REF }])
      expect(reportDegradation).toHaveBeenCalledWith('queue_invalid_envelope', { queue: QUEUE_NAME })
    })

    it('mints a distinct correlation per job without causation', () => {
      const first = runJobInCausation(QUEUE_NAME, undefined, () => getAmbientCausation())
      const second = runJobInCausation(QUEUE_NAME, undefined, () => getAmbientCausation())
      expect(first?.correlationId).not.toBe(second?.correlationId)
    })

    it('clears the context and reports nothing when the kill switch is off, even with stored metadata', () => {
      process.env.OM_CAUSATION = 'off'
      const seen = runWithCausation(POLLER, () =>
        runJobInCausation(QUEUE_NAME, { [CAUSATION_META_KEY]: ENQUEUER }, () => getAmbientCausation()),
      )
      expect(seen).toBeNull()
      runJobInCausation(QUEUE_NAME, undefined, () => undefined)
      runJobInCausation(QUEUE_NAME, { [CAUSATION_META_KEY]: 'garbage' }, () => undefined)
      expect(reportDegradation).not.toHaveBeenCalled()
    })

    it('propagates return values, synchronous throws and rejections unchanged', async () => {
      const failure = new Error('[internal] handler failed')
      expect(runJobInCausation(QUEUE_NAME, undefined, () => 42)).toBe(42)
      expect(() => runJobInCausation(QUEUE_NAME, undefined, () => { throw failure })).toThrow(failure)
      await expect(runJobInCausation(QUEUE_NAME, undefined, async () => { throw failure })).rejects.toBe(failure)
    })

    it('keeps the restored context across awaits inside the job and does not leak it out', async () => {
      const seen = await runJobInCausation(QUEUE_NAME, { [CAUSATION_META_KEY]: ENQUEUER }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        return getAmbientCausation()
      })
      expect(seen).toEqual(ENQUEUER)
      expect(getAmbientCausation()).toBeNull()
    })
  })
})
