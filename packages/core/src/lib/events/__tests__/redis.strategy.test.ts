jest.mock('ioredis', () => ({
  __esModule: true,
  default: class { async connect(){} async incr(){ return 1 } async zAdd(){ return 1 } async zRangeByScore(){ return [] } async set(){} async get(){ return '0' } async zRemRangeByScore(){ return 0 } },
  createClient: () => new (class { async connect(){} async incr(){ return 1 } async zAdd(){ return 1 } async zRangeByScore(){ return [] } async set(){} async get(){ return '0' } async zRemRangeByScore(){ return 0 } })(),
}), { virtual: true })

import { createEventBus } from '@mercato-core/lib/events'

describe('Event bus - redis strategy (mocked)', () => {
  const prevEnv = { ...process.env }
  beforeEach(() => {
    process.env.EVENTS_STRATEGY = 'redis'
    process.env.REDIS_URL = 'redis://localhost:6379'
  })
  afterEach(() => { process.env = { ...prevEnv } })

  test('create and emit non-persistent', async () => {
    const bus = createEventBus({ resolve: ((n: string) => n) as any })
    const recv: any[] = []
    bus.on('e', (p)=>recv.push(p))
    await bus.emitEvent('e', { ok: true })
    expect(recv.length).toBe(1)
  })
})
