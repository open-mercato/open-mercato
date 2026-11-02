import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createEventBus } from '@open-mercato/events/bus'
import processEvent from '@open-mercato/events/modules/events/workers/events.worker'
import type { JobHandler } from '@open-mercato/queue'
import { createLocalQueue } from '@open-mercato/queue/strategies/local'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { WarrantyClaim } from '../data/entities'
import type { ClaimCreateInput } from '../data/validators'

const mockFindOneWithDecryption = jest.fn<Promise<WarrantyClaim | null>, unknown[]>()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

import emailToClaim, { metadata } from '../subscribers/email-to-claim'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const CLAIM_ID = '33333333-3333-4333-8333-333333333333'

type EventJobPayload = Parameters<typeof processEvent>[0]['payload']
type CommandArgs = { input: ClaimCreateInput; ctx: CommandRuntimeContext }

describe('warranty email intake persistent worker retry', () => {
  beforeEach(() => {
    mockFindOneWithDecryption.mockReset()
  })

  test.each(['lookup', 'create', 'after-create'] as const)(
    'retries a transient %s failure and creates exactly one claim across redelivery',
    async (failurePoint) => {
      const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'warranty-email-retry-'))
      const queue = createLocalQueue<EventJobPayload>('events', { baseDir })
      const storedClaims: WarrantyClaim[] = []
      const failure = new Error('Transient intake dependency failure')
      const em = { fork: jest.fn(() => ({})) }
      const getValue = jest.fn(async () => true)
      const execute = jest.fn<Promise<{ result: { claimId: string } }>, [string, CommandArgs]>()
        .mockImplementation(async (_command, { input }) => {
          storedClaims.push({ id: CLAIM_ID, ...input, deletedAt: null } as WarrantyClaim)
          if (failurePoint === 'after-create' && storedClaims.length === 1) throw failure
          return { result: { claimId: CLAIM_ID } }
        })
      if (failurePoint === 'create') execute.mockRejectedValueOnce(failure)
      mockFindOneWithDecryption.mockImplementation(async () => storedClaims[0] ?? null)
      if (failurePoint === 'lookup') mockFindOneWithDecryption.mockRejectedValueOnce(failure)

      function resolve<T = unknown>(name: string): T {
        if (name === 'eventBus') return eventBus as T
        if (name === 'em') return em as T
        if (name === 'moduleConfigService') return { getValue } as T
        if (name === 'commandBus') return { execute } as T
        throw new Error(`[internal] Unexpected dependency: ${name}`)
      }

      const eventBus = createEventBus({ resolve })
      eventBus.registerModuleSubscribers([{ ...metadata, handler: emailToClaim }])
      const attempts: number[] = []
      const processDelivery: JobHandler<EventJobPayload> = (job, context) => {
        attempts.push(context.attemptNumber)
        return processEvent(job, { ...context, resolve })
      }
      const delivery: EventJobPayload = {
        event: metadata.event,
        payload: {
          tenantId: 'hostile-tenant',
          organizationId: 'hostile-org',
          messageId: 'email-retry-1',
          senderEmail: 'buyer@example.com',
          subject: 'Warranty request',
        },
        options: { tenantId: TENANT_ID, organizationId: ORG_ID },
      }

      try {
        await queue.enqueue(delivery)
        await expect(queue.process(processDelivery, { limit: 1 })).resolves.toMatchObject({ processed: 0, failed: 1 })
        await expect(queue.getJobCounts()).resolves.toMatchObject({ waiting: 1, completed: 0 })

        const retryTime = Date.now() + 60_000
        const clock = jest.spyOn(Date, 'now').mockReturnValue(retryTime)
        try {
          await expect(queue.process(processDelivery, { limit: 1 })).resolves.toMatchObject({ processed: 1, failed: 0 })
        } finally {
          clock.mockRestore()
        }

        await queue.enqueue(delivery)
        await expect(queue.process(processDelivery, { limit: 1 })).resolves.toMatchObject({ processed: 1, failed: 0 })
        await expect(queue.getJobCounts()).resolves.toMatchObject({ waiting: 0, completed: 2, failed: 0 })
        expect(attempts).toEqual([1, 2, 1])
        expect(storedClaims).toHaveLength(1)
        expect(execute).toHaveBeenCalledTimes(failurePoint === 'create' ? 2 : 1)
        expect(execute).toHaveBeenCalledWith('warranty_claims.claim.create', expect.objectContaining({
          input: expect.objectContaining({
            tenantId: TENANT_ID,
            organizationId: ORG_ID,
            intakeMessageRef: 'email-retry-1',
            contactEmail: 'buyer@example.com',
          }),
          ctx: expect.objectContaining({ systemActor: true, selectedOrganizationId: ORG_ID }),
        }))
        for (const lookup of mockFindOneWithDecryption.mock.calls) {
          expect(lookup[2]).toEqual({
            tenantId: TENANT_ID,
            organizationId: ORG_ID,
            intakeMessageRef: 'email-retry-1',
            deletedAt: null,
          })
        }
      } finally {
        await queue.close()
        await fs.rm(baseDir, { recursive: true, force: true })
      }
    },
  )
})
