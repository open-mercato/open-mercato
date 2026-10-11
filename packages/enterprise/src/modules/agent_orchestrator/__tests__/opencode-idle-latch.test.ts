import { OpenCodeAgentRunner, type OpenCodeRunnerClient } from '../lib/runtime/openCodeAgentRunner'

// H2 regression: between two nextIdle() waits (e.g. during the nudge grace delay)
// no waiter is registered. A busy→idle transition arriving in that window must be
// LATCHED so the next nextIdle() resolves immediately, rather than dropped (which
// would hang the runner until the wall-clock deadline). White-box test of the
// private subscribeSession: we drive the SSE callback directly.
type SseEvent = { type: string; properties: Record<string, unknown> }
type EventHandler = (event: SseEvent) => void
type IdleSignal = { nextIdle: () => Promise<void>; unsubscribe: () => void }

function makeIdleSignal(): { idle: IdleSignal; emit: EventHandler } {
  let captured: EventHandler = () => {}
  const client: OpenCodeRunnerClient = {
    createSession: async () => ({ id: 's1' }),
    sendMessage: async () => undefined,
    subscribeToEvents: (onEvent) => {
      captured = onEvent
      return () => {}
    },
  }
  const runner = new OpenCodeAgentRunner({
    container: {} as never,
    commandBus: {} as never,
    openCodeClient: client,
  })
  const idle = (
    runner as unknown as { subscribeSession: (id: string, toolCallSink: unknown[]) => IdleSignal }
  ).subscribeSession('s1', [])
  return { idle, emit: (event) => captured(event) }
}

const busy: SseEvent = { type: 'session.status', properties: { sessionID: 's1', status: { type: 'busy' } } }
const idleEvent: SseEvent = { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } }

/** Resolves true if `p` settles within `ms`, false otherwise (so a hang reads as false). */
function settlesWithin(p: Promise<void>, ms: number): Promise<boolean> {
  return Promise.race([
    p.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ])
}

describe('OpenCodeAgentRunner.subscribeSession — lost-wakeup latch (H2)', () => {
  it('resolves the next waiter immediately when a busy→idle arrived with no waiter registered', async () => {
    const { idle, emit } = makeIdleSignal()
    // No waiter registered yet — emit busy then idle (the lost-wakeup window).
    emit(busy)
    emit(idleEvent)
    // The NEXT waiter must resolve from the latch, not hang.
    expect(await settlesWithin(idle.nextIdle(), 50)).toBe(true)
    idle.unsubscribe()
  })

  it('still waits for a genuine future transition when nothing was latched', async () => {
    const { idle, emit } = makeIdleSignal()
    const waiter = idle.nextIdle()
    expect(await settlesWithin(waiter, 30)).toBe(false) // nothing emitted → pending
    emit(busy)
    emit(idleEvent)
    expect(await settlesWithin(waiter, 50)).toBe(true) // real transition resolves it
    idle.unsubscribe()
  })

  it('does not latch a bare idle with no preceding busy', async () => {
    const { idle, emit } = makeIdleSignal()
    emit(idleEvent) // idle without busy must NOT count as a transition
    expect(await settlesWithin(idle.nextIdle(), 30)).toBe(false)
    idle.unsubscribe()
  })
})
