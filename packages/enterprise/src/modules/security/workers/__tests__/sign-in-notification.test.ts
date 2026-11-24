import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { SignInNotificationIntent } from '../../data/entities'
import { deliverSignInNotification } from '../sign-in-notification'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

const candidate = { id: 'intent', tenantId: 'tenant' }
const intent = {
  ...candidate,
  organizationId: 'org',
  userId: 'user',
  knownDeviceId: 'device',
  sourceAttemptId: 'attempt',
  status: 'pending',
}

function fixture() {
  const transactionalIntent = { ...intent }
  const execute = jest.fn()
  const transaction = { execute, flush: jest.fn() }
  const em = { transactional: async (work: (tx: typeof transaction) => Promise<void>) => work(transaction) }
  const createBatch = jest.fn().mockResolvedValue([])
  jest.mocked(findOneWithDecryption).mockImplementation(async (_em, entity) =>
    entity === SignInNotificationIntent ? transactionalIntent : {
      occurredAt: new Date(), browserName: 'Firefox', osName: 'untrusted browser details',
    },
  )
  return {
    em: em as unknown as EntityManager,
    service: { createBatch } as unknown as ReturnType<typeof resolveNotificationService>,
    transactionalIntent,
    createBatch,
    execute,
  }
}

test('uses the new-device generation to deduplicate and allowlists notification variables', async () => {
  const { em, service, transactionalIntent, createBatch, execute } = fixture()
  await deliverSignInNotification(em, candidate, service)
  expect(execute).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), ['security:sign-in:notification:tenant:intent'])
  expect(createBatch).toHaveBeenCalledWith(expect.objectContaining({
    bodyVariables: { browser: 'Firefox', os: '—', time: expect.stringMatching(/UTC$/) },
    channels: ['in_app'],
    groupKey: 'sign_in_new_device:tenant:user:device',
  }), { tenantId: 'tenant', organizationId: 'org' }, { skipExistingGroup: true })
  expect(transactionalIntent.status).toBe('delivered')
})

test('retries with the same group after a delivery error before acknowledgement', async () => {
  const { em, service, transactionalIntent, createBatch } = fixture()
  createBatch.mockRejectedValueOnce(new Error('delivery failed after commit'))
  await expect(deliverSignInNotification(em, candidate, service)).rejects.toThrow('delivery failed')
  expect(transactionalIntent.status).toBe('pending')
  await deliverSignInNotification(em, candidate, service)
  expect(createBatch.mock.calls[0][0].groupKey).toBe(createBatch.mock.calls[1][0].groupKey)
  expect(transactionalIntent.status).toBe('delivered')
})
