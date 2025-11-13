jest.mock('ioredis', () => {
  const MockRedis = class { 
    constructor() {
      this.status = 'ready'
    }
    status = 'ready'
    async connect(){ 
      this.status = 'ready'
      return this
    } 
    async incr(){ return 1 } 
    async zAdd(){ return 1 } 
    async zRangeByScore(){ return [] } 
    async set(){} 
    async get(){ return '0' } 
    async zRemRangeByScore(){ return 0 } 
  }
  
  return {
    __esModule: true,
    default: MockRedis,
    Redis: MockRedis
  }
}, { virtual: true })

import { createEventBus } from '@open-mercato/events/index'

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
    bus.on('e', (p) => {
      recv.push(p)
    })
    await bus.emitEvent('e', { ok: true })
    expect(recv.length).toBe(1)
  })
})
