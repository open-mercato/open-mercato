import {
  beginWorkerJob,
  hasWorkerGates,
  notifyWorkerRunnerStarted,
  registerWorkerGate,
  shouldPauseWork,
  unregisterWorkerGate,
  waitWhileWorkPaused,
  withWorkerGate,
} from '../worker-gate'

afterEach(() => {
  unregisterWorkerGate('test')
  unregisterWorkerGate('thrower')
})

describe('worker gate', () => {
  it('runs handlers unchanged with no gate', async () => {
    expect(hasWorkerGates()).toBe(false)
    const handler = withWorkerGate({ kind: 'worker', queueName: 'events' }, async (value: number) => value * 2)
    await expect(handler(21)).resolves.toBe(42)
  })

  it('waits while paused and resumes, firing callbacks once', async () => {
    let paused = true
    const events: string[] = []
    registerWorkerGate({
      id: 'test',
      shouldPause: () => paused,
      onPaused: () => events.push('paused'),
      onResumed: () => events.push('resumed'),
    })
    const waiting = waitWhileWorkPaused({ kind: 'worker' }, { pollMs: 5 })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(events).toEqual(['paused'])
    paused = false
    await waiting
    expect(events).toEqual(['paused', 'resumed'])
  })

  it('counts a job in flight until it settles, even when it throws', async () => {
    let inflight = 0
    let observed = -1
    registerWorkerGate({
      id: 'test',
      shouldPause: () => false,
      onJobStarted: () => {
        inflight += 1
        return () => { inflight -= 1 }
      },
    })
    const handler = withWorkerGate({ kind: 'worker' }, async () => {
      observed = inflight
      throw new Error('job failed')
    })
    await expect(handler()).rejects.toThrow('job failed')
    expect(observed).toBe(1)
    expect(inflight).toBe(0)
  })

  it('treats a throwing gate as not pausing', () => {
    registerWorkerGate({ id: 'thrower', shouldPause: () => { throw new Error('boom') } })
    expect(shouldPauseWork({ kind: 'scheduler' })).toBe(false)
    const release = beginWorkerJob({ kind: 'scheduler' })
    expect(() => release()).not.toThrow()
  })

  it('notifies gates when a runner starts', () => {
    const started: string[] = []
    registerWorkerGate({ id: 'test', shouldPause: () => false, onRunnerStarted: (info) => { started.push(`${info.kind}:${info.queueName ?? ''}`) } })
    notifyWorkerRunnerStarted({ kind: 'worker', queueName: 'events' })
    expect(started).toEqual(['worker:events'])
  })
})
