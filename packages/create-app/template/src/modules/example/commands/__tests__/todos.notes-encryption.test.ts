/**
 * `notes` is covered by this module's encryption map, and the todo update path
 * writes through `nativeUpdate`, which MikroORM documents as having no side
 * effects on the context — the tenant-encryption ORM subscriber never fires.
 *
 * Without `buildTodoUpdatePatch` encrypting the value itself, `notes` would be
 * written as plaintext while every read path decrypts it, and nothing else in the
 * module would fail: the column is nullable, the form round-trips, and the value
 * even reads back "correctly" because decryption leaves unrecognised input alone.
 * These assertions are the only thing standing between that bug and a release.
 */
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

import { buildTodoUpdatePatch, type TodoEncryptionService } from '../todos'

const SCOPE = {
  tenantId: '33333333-3333-4333-8333-333333333333',
  organizationId: '22222222-2222-4222-8222-222222222222',
}

function createEncryption(): { service: TodoEncryptionService; calls: unknown[][] } {
  const calls: unknown[][] = []
  const service: TodoEncryptionService = {
    encryptEntityPayload: async (entityId, payload, tenantId, organizationId) => {
      calls.push([entityId, payload, tenantId, organizationId])
      const result: Record<string, unknown> = { ...payload }
      if (typeof payload.notes === 'string') result.notes = `enc(${payload.notes})`
      return result
    },
  }
  return { service, calls }
}

describe('todo update patch encryption', () => {
  it('never puts a plaintext notes value in the native-update patch', async () => {
    const { service } = createEncryption()

    const patch = await buildTodoUpdatePatch({ notes: 'card ending 4242' }, SCOPE, service)

    expect(patch.notes).toBe('enc(card ending 4242)')
    expect(patch.notes).not.toBe('card ending 4242')
  })

  it('encrypts under the caller scope and against this module entity id', async () => {
    const { service, calls } = createEncryption()

    await buildTodoUpdatePatch({ notes: 'private' }, SCOPE, service)

    expect(calls).toEqual([
      ['example:todo', { notes: 'private' }, SCOPE.tenantId, SCOPE.organizationId],
    ])
  })

  it('leaves the non-encrypted columns untouched', async () => {
    const { service, calls } = createEncryption()

    const patch = await buildTodoUpdatePatch({ title: 'Ship it', isDone: true }, SCOPE, service)

    expect(patch).toEqual({ title: 'Ship it', isDone: true })
    expect(calls).toEqual([])
  })

  it('clears the column without an encryption round-trip when notes is null', async () => {
    const { service, calls } = createEncryption()

    const patch = await buildTodoUpdatePatch({ notes: null }, SCOPE, service)

    expect(patch).toEqual({ notes: null })
    expect(calls).toEqual([])
  })

  it('omits notes entirely when the payload did not carry it', async () => {
    const { service } = createEncryption()

    const patch = await buildTodoUpdatePatch({ title: 'Only the title' }, SCOPE, service)

    expect(Object.prototype.hasOwnProperty.call(patch, 'notes')).toBe(false)
  })

  it('fails closed when encryption is unavailable', async () => {
    await expect(buildTodoUpdatePatch({ notes: 'plain' }, SCOPE, null)).rejects.toThrow(
      '[internal] Todo notes encryption service is unavailable',
    )
  })

  it('fails closed when the service returns no ciphertext', async () => {
    const service: TodoEncryptionService = {
      encryptEntityPayload: async (_entityId, payload) => ({ ...payload, notes: undefined }),
    }

    await expect(buildTodoUpdatePatch({ notes: 'plain' }, SCOPE, service)).rejects.toThrow(
      '[internal] Todo notes encryption did not produce ciphertext',
    )
  })

  it('fails closed when the service returns the plaintext unchanged', async () => {
    const service: TodoEncryptionService = {
      encryptEntityPayload: async (_entityId, payload) => payload,
    }

    await expect(buildTodoUpdatePatch({ notes: 'plain' }, SCOPE, service)).rejects.toThrow(
      '[internal] Todo notes encryption did not produce ciphertext',
    )
  })
})
