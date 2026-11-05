import { setup } from '../setup'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function makeContainer() {
  const register = jest.fn().mockResolvedValue(undefined)
  return {
    register,
    container: {
      resolve(name: string) {
        if (name !== 'schedulerService') throw new Error(`unexpected registration: ${name}`)
        return { register }
      },
    },
  }
}

describe('ai_assistant setup schedules', () => {
  it('registers module schedules with uuid ids accepted by the scheduler table', async () => {
    const { container, register } = makeContainer()

    await setup.seedDefaults?.({ container } as never)

    expect(register).toHaveBeenCalledTimes(2)
    const ids = register.mock.calls.map(([registration]) => registration.id)

    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    expect(ids).not.toContain('ai_assistant:pending-action-cleanup')
    expect(ids).not.toContain('ai_assistant:token-usage-prune')
    expect(ids.every((id) => UUID_RE.test(id))).toBe(true)
  })
})
