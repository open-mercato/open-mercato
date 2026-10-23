import { resolveChannelThreadWideningIds } from '../channelThreadWidening'

const SCOPE = {
  userId: 'operator-1',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  features: ['messages.view'],
}

function makeContainer(options: {
  granted?: boolean
  list?: ((...args: unknown[]) => unknown) | null
  rbacMissing?: boolean
}) {
  const rbac = options.rbacMissing
    ? null
    : { userHasAllFeatures: jest.fn(async () => options.granted ?? true) }
  return {
    resolve: (name: string) => {
      if (name === 'rbacService') return rbac
      if (name === 'communicationChannelsListAccessibleChannelThreadIds') {
        if (options.list === undefined) throw new Error('not registered')
        return options.list
      }
      throw new Error(`unexpected ${name}`)
    },
  } as any
}

describe('resolveChannelThreadWideningIds (#6106)', () => {
  it('returns the accessible thread ids when the caller holds messages.view', async () => {
    const list = jest.fn(async () => ['thread-a', 'thread-b'])
    const ids = await resolveChannelThreadWideningIds(makeContainer({ list }), SCOPE)
    expect(ids).toEqual(['thread-a', 'thread-b'])
    expect(list).toHaveBeenCalledWith(expect.anything(), { tenantId: 'tenant-1', organizationId: 'org-1' }, {
      userId: 'operator-1',
      features: ['messages.view'],
    })
  })

  it('widens nothing without messages.view, and never reaches the hub', async () => {
    const list = jest.fn(async () => ['thread-a'])
    const ids = await resolveChannelThreadWideningIds(makeContainer({ granted: false, list }), SCOPE)
    expect(ids).toEqual([])
    expect(list).not.toHaveBeenCalled()
  })

  it('widens nothing when RBAC is unavailable', async () => {
    const list = jest.fn(async () => ['thread-a'])
    await expect(resolveChannelThreadWideningIds(makeContainer({ rbacMissing: true, list }), SCOPE)).resolves.toEqual([])
    expect(list).not.toHaveBeenCalled()
  })

  it('widens nothing when the channels hub is not installed', async () => {
    await expect(resolveChannelThreadWideningIds(makeContainer({ list: undefined }), SCOPE)).resolves.toEqual([])
  })

  it('widens nothing when the hub lookup throws', async () => {
    const list = jest.fn(async () => {
      throw new Error('db down')
    })
    await expect(resolveChannelThreadWideningIds(makeContainer({ list }), SCOPE)).resolves.toEqual([])
  })

  it('widens nothing when the hub answers null (over its list limit)', async () => {
    const list = jest.fn(async () => null)
    await expect(resolveChannelThreadWideningIds(makeContainer({ list }), SCOPE)).resolves.toEqual([])
  })
})
