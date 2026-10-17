import {
  CAUSATION_MAX_BYTES,
  CAUSATION_MAX_FRAMES,
  primaryCause,
  projectCausation,
  sanitizeCausation,
  type CausationEnvelope,
} from '../types'
import {
  appendCausationFrame,
  buildEntryCausationForAuth,
  createCausationEnvelope,
  getAmbientCausation,
  isCausationEnabled,
  resolveCausationForCommand,
  runWithRequestCausation,
  runEntryWithCausation,
  runOutsideCausation,
  runWithCausation,
  stripCausationFromContext,
  withCausationFrame,
  reportCausationDegradation,
  resetCausationDegradationReports,
} from '../server'
import { toIdentifierOnlyCausation } from '../types'

const CORRELATION_ID = '11111111-1111-4111-8111-111111111111'
const LOG_ID = '22222222-2222-4222-8222-222222222222'

function envelopeWith(frames: CausationEnvelope['frames']): CausationEnvelope {
  return { correlationId: CORRELATION_ID, frames }
}

describe('sanitizeCausation', () => {
  it('rejects non-objects, missing correlation and empty frames', () => {
    expect(sanitizeCausation(null)).toBeNull()
    expect(sanitizeCausation('x')).toBeNull()
    expect(sanitizeCausation({ frames: [{ kind: 'user' }] })).toBeNull()
    expect(sanitizeCausation({ correlationId: CORRELATION_ID, frames: [] })).toBeNull()
    expect(sanitizeCausation({ correlationId: CORRELATION_ID, frames: [{ kind: 'not-a-kind' }] })).toBeNull()
  })

  it('drops invalid frames, non-scalar meta and an invalid causedByLogId', () => {
    const result = sanitizeCausation({
      correlationId: CORRELATION_ID,
      causedByLogId: 'not-a-uuid',
      frames: [
        { kind: 'bogus' },
        { kind: 'workflow', id: ' wf-1 ', ref: '', meta: { step: 'a', nested: { deep: true }, count: 2, bad: Number.NaN } },
      ],
    })
    expect(result).toEqual({
      correlationId: CORRELATION_ID,
      frames: [{ kind: 'workflow', id: 'wf-1', meta: { step: 'a', count: 2 } }],
      truncated: true,
    })
  })

  it('keeps the entry frame and the innermost frames when over the frame cap', () => {
    const frames = Array.from({ length: CAUSATION_MAX_FRAMES + 4 }, (_, index) => ({
      kind: 'subscriber' as const,
      id: `sub-${index}`,
    }))
    const result = sanitizeCausation(envelopeWith(frames))
    expect(result?.frames).toHaveLength(CAUSATION_MAX_FRAMES)
    expect(result?.frames[0].id).toBe('sub-0')
    expect(result?.frames[result.frames.length - 1].id).toBe(`sub-${frames.length - 1}`)
    expect(result?.truncated).toBe(true)
  })

  it('enforces the byte cap while preserving the primary cause', () => {
    const longText = 'x'.repeat(190)
    const frames = Array.from({ length: CAUSATION_MAX_FRAMES }, (_, index) => ({
      kind: 'subscriber' as const,
      id: `${longText}-${index}`,
      ref: longText,
      meta: { first: longText, second: longText },
    }))
    const result = sanitizeCausation(envelopeWith(frames))
    expect(result).not.toBeNull()
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(CAUSATION_MAX_BYTES)
    expect(primaryCause(result).id).toBe(frames[frames.length - 1].id.slice(0, 200))
    expect(result?.truncated).toBe(true)
  })
})

describe('primaryCause and projectCausation', () => {
  it('returns the innermost frame as the primary cause', () => {
    const envelope = envelopeWith([{ kind: 'user' }, { kind: 'workflow', id: 'instance-1' }])
    expect(primaryCause(envelope)).toEqual({ kind: 'workflow', id: 'instance-1' })
    expect(primaryCause(null)).toEqual({ kind: 'unknown', id: null })
  })

  it('projects columns and drops non-uuid correlation ids from the column', () => {
    expect(projectCausation(envelopeWith([{ kind: 'api_key', id: 'key-1' }]))).toMatchObject({
      causeKind: 'api_key',
      causeId: 'key-1',
      correlationId: CORRELATION_ID,
      causedByLogId: null,
    })
    expect(projectCausation({ correlationId: 'not-uuid', frames: [{ kind: 'user' }] })?.correlationId).toBeNull()
    expect(projectCausation(null)).toBeNull()
  })
})

describe('ambient causation storage', () => {
  it('isolates concurrent async contexts', async () => {
    const seen: Array<string | null> = []
    await Promise.all(
      ['a', 'b', 'c'].map((id) =>
        runEntryWithCausation({ kind: 'workflow', id }, async () => {
          await new Promise((resolve) => setTimeout(resolve, 5))
          seen.push(primaryCause(getAmbientCausation()).id)
        }),
      ),
    )
    expect(seen.sort()).toEqual(['a', 'b', 'c'])
    expect(getAmbientCausation()).toBeNull()
  })

  it('stacks frames and keeps the correlation id', () => {
    runEntryWithCausation({ kind: 'user' }, () => {
      const outer = getAmbientCausation()
      withCausationFrame({ kind: 'subscriber', id: 'sub-1', ref: 'module.entity.created' }, () => {
        const inner = getAmbientCausation()
        expect(inner?.correlationId).toBe(outer?.correlationId)
        expect(inner?.frames.map((frame) => frame.kind)).toEqual(['user', 'subscriber'])
      })
      expect(getAmbientCausation()?.frames).toHaveLength(1)
    })
  })

  it('runOutsideCausation detaches timers created inside a request', async () => {
    const observed = await runEntryWithCausation({ kind: 'user' }, () =>
      runOutsideCausation(() => new Promise<boolean>((resolve) => setTimeout(() => resolve(getAmbientCausation() === null), 1))),
    )
    expect(observed).toBe(true)
  })

  it('runWithCausation(null) resets the ambient envelope', () => {
    runEntryWithCausation({ kind: 'user' }, () => {
      runWithCausation(null, () => {
        expect(getAmbientCausation()).toBeNull()
      })
    })
  })

  it('shares one storage instance across duplicated module copies', () => {
    let isolatedGetter: typeof getAmbientCausation | null = null
    jest.isolateModules(() => {
      isolatedGetter = (require('../server') as typeof import('../server')).getAmbientCausation
    })
    runEntryWithCausation({ kind: 'schedule', id: 'schedule-1' }, () => {
      expect(primaryCause(isolatedGetter?.() ?? null)).toEqual({ kind: 'schedule', id: 'schedule-1' })
    })
  })
})

describe('resolveCausationForCommand', () => {
  it('prefers explicit causation over ambient and auth', () => {
    const explicit = envelopeWith([{ kind: 'ai_action', id: 'action-1' }])
    runEntryWithCausation({ kind: 'user' }, () => {
      expect(primaryCause(resolveCausationForCommand({ explicit, auth: { sub: 'user-1' } }))).toEqual({
        kind: 'ai_action',
        id: 'action-1',
      })
    })
  })

  it('uses the ambient envelope before auth-derived causation', () => {
    runEntryWithCausation({ kind: 'workflow', id: 'instance-1' }, () => {
      expect(primaryCause(resolveCausationForCommand({ auth: { sub: 'user-1' } })).kind).toBe('workflow')
    })
  })

  it('derives api key, user, system and unknown frames from auth', () => {
    expect(primaryCause(resolveCausationForCommand({ auth: { sub: 'x', isApiKey: true, keyId: 'key-1' } }))).toEqual({
      kind: 'api_key',
      id: 'key-1',
    })
    expect(primaryCause(resolveCausationForCommand({ auth: { sub: 'user-1' } }))).toEqual({ kind: 'user', id: null })
    expect(primaryCause(resolveCausationForCommand({ auth: null, systemActor: true })).kind).toBe('system')
    expect(primaryCause(resolveCausationForCommand({ auth: null })).kind).toBe('unknown')
  })

  it('treats a lone anonymous entry frame as absent but keeps its correlation id', () => {
    runEntryWithCausation({ kind: 'unknown' }, () => {
      const ambient = getAmbientCausation()
      const resolved = resolveCausationForCommand({ auth: null, systemActor: true })
      expect(primaryCause(resolved).kind).toBe('system')
      expect(resolved.correlationId).toBe(ambient?.correlationId)
      expect(resolveCausationForCommand({ auth: null })).toEqual(ambient)
    })
    runEntryWithCausation({ kind: 'unknown' }, () =>
      withCausationFrame({ kind: 'subscriber', id: 'sub-1' }, () => {
        expect(primaryCause(resolveCausationForCommand({ auth: null, systemActor: true })).kind).toBe('subscriber')
      }),
    )
  })

  it('appends an agent frame for runAs without duplicating it', () => {
    const result = resolveCausationForCommand({ auth: { sub: 'user-1' }, runAs: { actorUserId: 'agent-1' } })
    expect(result.frames.map((frame) => frame.kind)).toEqual(['user', 'agent'])
    const again = runWithCausation(result, () =>
      resolveCausationForCommand({ auth: { sub: 'user-1' }, runAs: { actorUserId: 'agent-1' } }),
    )
    expect(again.frames.map((frame) => frame.kind)).toEqual(['user', 'agent'])
  })
})

describe('buildEntryCausationForAuth', () => {
  it('honours originCausation only for api keys', () => {
    const origin = envelopeWith([{ kind: 'user' }, { kind: 'business_rule', id: 'rule-1', ref: 'run-1' }])
    expect(primaryCause(buildEntryCausationForAuth({ sub: 'k', isApiKey: true, keyId: 'key-1', originCausation: origin }))).toEqual({
      kind: 'business_rule',
      id: 'rule-1',
    })
    expect(primaryCause(buildEntryCausationForAuth({ sub: 'user-1', originCausation: origin }))).toEqual({
      kind: 'user',
      id: null,
    })
    expect(primaryCause(buildEntryCausationForAuth({ sub: 'k', isApiKey: true, keyId: 'key-2', originCausation: { bogus: true } }))).toEqual({
      kind: 'api_key',
      id: 'key-2',
    })
  })
})

describe('request entry and kill switch', () => {
  const previous = process.env.OM_CAUSATION

  afterEach(() => {
    if (previous === undefined) delete process.env.OM_CAUSATION
    else process.env.OM_CAUSATION = previous
  })

  it('isCausationEnabled defaults to on and honours off tokens', () => {
    expect(isCausationEnabled({})).toBe(true)
    expect(isCausationEnabled({ OM_CAUSATION: 'off' })).toBe(false)
    expect(isCausationEnabled({ OM_CAUSATION: 'garbage' })).toBe(true)
  })

  it('runWithRequestCausation seeds an entry envelope from auth', () => {
    delete process.env.OM_CAUSATION
    runWithRequestCausation({ sub: 'k', isApiKey: true, keyId: 'key-9' }, () => {
      expect(primaryCause(getAmbientCausation())).toEqual({ kind: 'api_key', id: 'key-9' })
    })
  })

  it('runWithRequestCausation leaves the context untouched when disabled', () => {
    process.env.OM_CAUSATION = 'off'
    runWithRequestCausation({ sub: 'user-1' }, () => {
      expect(getAmbientCausation()).toBeNull()
    })
  })
})

describe('review hardening', () => {
  const previous = process.env.OM_CAUSATION

  afterEach(() => {
    if (previous === undefined) delete process.env.OM_CAUSATION
    else process.env.OM_CAUSATION = previous
  })

  it('rejects an envelope whose innermost frame is not understood', () => {
    expect(sanitizeCausation(envelopeWith([{ kind: 'user' }, { kind: 'future_kind' } as never]))).toBeNull()
    const outerInvalid = sanitizeCausation(envelopeWith([{ kind: 'future_kind' } as never, { kind: 'workflow', id: 'w-1' }]))
    expect(primaryCause(outerInvalid)).toEqual({ kind: 'workflow', id: 'w-1' })
    expect(outerInvalid?.truncated).toBe(true)
  })

  it('strips control characters before persisting text', () => {
    const result = sanitizeCausation(envelopeWith([{ kind: 'subscriber', id: 'sub\u0000-1', ref: 'event\nname' }]))
    expect(result?.frames[0]).toEqual({ kind: 'subscriber', id: 'sub-1', ref: 'eventname' })
  })

  it('bounds the number of raw frames inspected', () => {
    const frames = Array.from({ length: 5000 }, (_, index) => ({ kind: 'subscriber' as const, id: `s-${index}` }))
    const result = sanitizeCausation(envelopeWith(frames))
    expect(result?.frames[0].id).toBe('s-0')
    expect(primaryCause(result).id).toBe('s-4999')
    expect(result?.truncated).toBe(true)
  })

  it('reduces envelopes to identifiers for plaintext storage', () => {
    const reduced = toIdentifierOnlyCausation({
      correlationId: CORRELATION_ID,
      causedByLogId: LOG_ID,
      frames: [
        { kind: 'subscriber', id: 'sub-1', ref: 'customers.person.updated', meta: { attempt: 2 } },
        { kind: 'business_rule', id: 'rule-1', ref: LOG_ID },
      ],
    })
    expect(reduced).toEqual({
      correlationId: CORRELATION_ID,
      causedByLogId: LOG_ID,
      frames: [
        { kind: 'subscriber', id: 'sub-1' },
        { kind: 'business_rule', id: 'rule-1', ref: LOG_ID },
      ],
    })
  })

  it('keeps the origin chain and records the loopback key on the innermost frame', () => {
    const origin = { ...envelopeWith([{ kind: 'user' }, { kind: 'business_rule', id: 'rule-1', ref: 'run-1' }]), causedByLogId: LOG_ID }
    const entry = buildEntryCausationForAuth({ sub: 'k', isApiKey: true, keyId: 'key-7', originCausation: origin })
    expect(entry.causedByLogId).toBe(LOG_ID)
    expect(entry.frames[entry.frames.length - 1]).toEqual({ kind: 'business_rule', id: 'rule-1', ref: 'run-1', meta: { viaKeyId: 'key-7' } })
  })

  it('does not treat an identified unknown entry as anonymous', () => {
    runEntryWithCausation({ kind: 'unknown', ref: 'queue:missing_causation' }, () => {
      expect(resolveCausationForCommand({ auth: { sub: 'user-1' } }).frames).toEqual([
        { kind: 'unknown', ref: 'queue:missing_causation' },
      ])
    })
  })

  it('frame helpers are inert when causation is disabled', () => {
    process.env.OM_CAUSATION = 'off'
    runEntryWithCausation({ kind: 'schedule', id: 's-1' }, () => {
      expect(getAmbientCausation()).toBeNull()
      withCausationFrame({ kind: 'sync_run', id: 'r-1' }, () => expect(getAmbientCausation()).toBeNull())
    })
  })

  it('reports each degradation reason once at warn level and then at debug', () => {
    resetCausationDegradationReports()
    const { createLogger } = require('../../logger') as typeof import('../../logger')
    const logger = createLogger('causation')
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const debug = jest.spyOn(logger, 'debug').mockImplementation(() => undefined)
    reportCausationDegradation('api_key_origin_invalid', { keyId: 'k-1' })
    reportCausationDegradation('api_key_origin_invalid', { keyId: 'k-1' })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(debug).toHaveBeenCalledTimes(1)
    warn.mockRestore()
    debug.mockRestore()
  })
})

describe('helpers', () => {
  it('appendCausationFrame ignores invalid frames', () => {
    const envelope = createCausationEnvelope([{ kind: 'user' }], { correlationId: CORRELATION_ID })
    expect(appendCausationFrame(envelope, { kind: 'nope' } as never)).toBe(envelope)
    expect(appendCausationFrame(envelope, { kind: 'redo', id: LOG_ID }).frames).toHaveLength(2)
  })

  it('stripCausationFromContext removes only the causation key', () => {
    expect(stripCausationFromContext({ causation: { x: 1 }, source: 'agent' })).toEqual({ source: 'agent' })
    const untouched = { source: 'ui' }
    expect(stripCausationFromContext(untouched)).toBe(untouched)
    expect(stripCausationFromContext(null)).toBeNull()
  })
})
