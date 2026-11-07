import { setup } from '../setup'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'

function makeContainer(register: jest.Mock | null) {
  return {
    hasRegistration: (name: string) => name === 'schedulerService' && register !== null,
    resolve: (name: string) => {
      if (name === 'schedulerService' && register) return { register }
      throw new Error(`unknown ${name}`)
    },
  }
}

function run(container: unknown) {
  return setup.seedDefaults!({ tenantId: TENANT_ID, organizationId: ORG_ID, container } as never)
}

describe('assisted_selling setup.seedDefaults schedule registration', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('registers both the idle-close and retention schedules', async () => {
    const register = jest.fn(async () => undefined)
    await run(makeContainer(register))
    const queues = register.mock.calls.map((call) => (call[0] as { targetQueue: string }).targetQueue)
    expect(queues).toEqual(['assisted_selling.idle_close', 'assisted_selling.retention'])
  })

  it('retries a transient registration failure and succeeds without throwing', async () => {
    const register = jest
      .fn()
      .mockRejectedValueOnce(new Error('db blip'))
      .mockResolvedValue(undefined)
    const pending = run(makeContainer(register))
    await jest.advanceTimersByTimeAsync(5000)
    await expect(pending).resolves.toBeUndefined()
    expect(register).toHaveBeenCalledTimes(3)
  })

  it('surfaces a persistent registration failure instead of swallowing it', async () => {
    const register = jest.fn(async (registration: { targetQueue: string }) => {
      if (registration.targetQueue === 'assisted_selling.retention') throw new Error('scheduler down')
    })
    const pending = run(makeContainer(register as unknown as jest.Mock))
    const assertion = expect(pending).rejects.toThrow(/schedule registration/)
    await jest.advanceTimersByTimeAsync(5000)
    await assertion
  })

  it('does not throw (but logs/reports) when the scheduler service is not registered at all', async () => {
    await expect(run(makeContainer(null))).resolves.toBeUndefined()
  })
})
