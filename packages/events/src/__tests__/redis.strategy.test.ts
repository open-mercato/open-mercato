jest.mock('ioredis', () => {
  const MockRedis = class {
    status = 'ready'
    connect = jest.fn(async () => this)
    incr = jest.fn(async () => 1)
    zAdd = jest.fn(async () => 1)
    zadd = jest.fn(async () => 1)
    zRangeByScore = jest.fn(async () => [])
    zrangebyscore = jest.fn(async () => [])
    set = jest.fn(async () => undefined)
    get = jest.fn(async () => '0')
    zRemRangeByScore = jest.fn(async () => 0)
    zremrangebyscore = jest.fn(async () => 0)
  }

  return {
    __esModule: true,
    default: MockRedis,
    Redis: MockRedis,
  }
})

type CreateEventBus = typeof import('@open-mercato/events/index').createEventBus

describe('Event bus - redis strategy (mocked)', () => {
  const prevEnv = { ...process.env }
  let createEventBus: CreateEventBus
  beforeEach(() => {
    jest.resetModules()
    process.env.EVENTS_STRATEGY = 'redis'
    process.env.REDIS_URL = 'redis://localhost:6379'
  })
  beforeEach(async () => {
    const mod = await import('@open-mercato/events/index')
    createEventBus = mod.createEventBus
  })
  afterEach(() => {
    process.env = { ...prevEnv }
    jest.clearAllMocks()
  })

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
