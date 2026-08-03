/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const ORG_ID = '123e4567-e89b-12d3-a456-426614174000'
const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const LINK_ID = '123e4567-e89b-12d3-a456-426614174010'
const TEMPLATE_ID = '123e4567-e89b-12d3-a456-426614174020'
const CURRENT_VERSION = '2026-06-01T10:00:00.000Z'
const STALE_VERSION = '2026-06-01T09:00:00.000Z'

const FLUSH_SENTINEL = 'FLUSH_REACHED_AFTER_LOCK'

const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

jest.mock('../../lib/gatewayProviderAvailability', () => ({
  ensureGatewayProviderConfigured: jest.fn(async () => undefined),
  getGatewayProviderConfigurationMessageKey: jest.fn(() => null),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  setCustomFieldsIfAny: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => ({
  loadCustomFieldSnapshot: jest.fn(async () => ({})),
  buildCustomFieldResetMap: jest.fn(() => ({})),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(async () => ({})),
}))

jest.mock('../../events', () => ({
  emitCheckoutEvent: jest.fn(async () => undefined),
}))

// Importing the command modules registers the handlers via registerCommand.
import '../links'
import '../templates'

// flush runs immediately AFTER the lock guard in both update commands. Throwing
// a recognizable sentinel here lets the match / no-header cases prove the lock
// guard PASSED, without mocking the full post-flush path (custom fields, events).
const mockEm = {
  flush: jest.fn(async () => {
    throw new Error(FLUSH_SENTINEL)
  }),
  // delete commands count active transactions before flushing; 0 lets the
  // happy path reach the flush sentinel so we can prove the lock guard passed.
  count: jest.fn(async () => 0),
}

const mockDataEngine = {}

type GuardServiceOverride = { enforce: (input: unknown) => Promise<void> } | undefined

function makeContext(headerVersion: string | null, guardService?: GuardServiceOverride): CommandRuntimeContext {
  const headers = new Headers()
  if (headerVersion) headers.set(OPTIMISTIC_LOCK_HEADER_NAME, headerVersion)
  const request = new Request('http://localhost/api/checkout/links/x', { method: 'PUT', headers })
  return {
    container: {
      resolve: (token: string) => {
        if (token === 'em') return mockEm
        if (token === 'dataEngine') return mockDataEngine
        if (token === 'paymentGatewayDescriptorService') return {}
        // Phase 6b async seam resolves the optional enterprise guard from the
        // request container; OSS-only builds resolve nothing.
        if (token === 'commandOptimisticLockGuardService') {
          if (guardService === undefined) throw new Error('not registered')
          return guardService
        }
        return null
      },
    } as unknown as CommandRuntimeContext['container'],
    auth: { orgId: ORG_ID, tenantId: TENANT_ID } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
    request,
  }
}

function linkRecord() {
  return {
    id: LINK_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    name: 'Pay link',
    title: null,
    slug: 'pay-link',
    templateId: null,
    status: 'draft',
    isLocked: false,
    pricingMode: 'fixed',
    gatewayProviderKey: null,
    gatewaySettings: {},
    fixedPriceAmount: null,
    fixedPriceOriginalAmount: null,
    customAmountMin: null,
    customAmountMax: null,
    passwordHash: null,
    updatedAt: new Date(CURRENT_VERSION),
  }
}

function templateRecord() {
  return {
    id: TEMPLATE_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    name: 'Template',
    title: null,
    status: 'draft',
    pricingMode: 'fixed',
    gatewayProviderKey: null,
    gatewaySettings: {},
    fixedPriceAmount: null,
    fixedPriceOriginalAmount: null,
    customAmountMin: null,
    customAmountMax: null,
    passwordHash: null,
    updatedAt: new Date(CURRENT_VERSION),
  }
}

async function runUpdate(
  commandId: string,
  input: Record<string, unknown>,
  headerVersion: string | null,
  guardService?: GuardServiceOverride,
) {
  const handler = commandRegistry.get(commandId)
  if (!handler) throw new Error(`Command ${commandId} not registered`)
  return handler.execute(input, makeContext(headerVersion, guardService))
}

describe('checkout command optimistic locking', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.OM_OPTIMISTIC_LOCK
  })

  describe('checkout.link.update', () => {
    beforeEach(() => {
      mockFindOneWithDecryption.mockResolvedValue(linkRecord())
    })

    it('rejects a stale expected version with a structured 409 conflict', async () => {
      expect.assertions(4)
      try {
        await runUpdate('checkout.link.update', { id: LINK_ID, status: 'draft' }, STALE_VERSION)
      } catch (error) {
        const httpError = error as { status?: number; body?: Record<string, unknown> }
        expect(httpError.status).toBe(409)
        expect(httpError.body?.code).toBe('optimistic_lock_conflict')
        expect(httpError.body?.currentUpdatedAt).toBe(CURRENT_VERSION)
        expect(mockEm.flush).not.toHaveBeenCalled()
      }
    })

    it('passes the lock guard when the expected version matches', async () => {
      await expect(
        runUpdate('checkout.link.update', { id: LINK_ID, status: 'draft' }, CURRENT_VERSION),
      ).rejects.toThrow(FLUSH_SENTINEL)
    })

    it('passes the lock guard when no expected-version header is sent (strictly additive)', async () => {
      await expect(
        runUpdate('checkout.link.update', { id: LINK_ID, status: 'draft' }, null),
      ).rejects.toThrow(FLUSH_SENTINEL)
    })
  })

  describe('checkout.template.update', () => {
    beforeEach(() => {
      mockFindOneWithDecryption.mockResolvedValue(templateRecord())
    })

    it('rejects a stale expected version with a structured 409 conflict', async () => {
      expect.assertions(3)
      try {
        await runUpdate('checkout.template.update', { id: TEMPLATE_ID, status: 'draft' }, STALE_VERSION)
      } catch (error) {
        const httpError = error as { status?: number; body?: Record<string, unknown> }
        expect(httpError.status).toBe(409)
        expect(httpError.body?.code).toBe('optimistic_lock_conflict')
        expect(mockEm.flush).not.toHaveBeenCalled()
      }
    })

    it('passes the lock guard when the expected version matches', async () => {
      await expect(
        runUpdate('checkout.template.update', { id: TEMPLATE_ID, status: 'draft' }, CURRENT_VERSION),
      ).rejects.toThrow(FLUSH_SENTINEL)
    })

    it('passes the lock guard when no expected-version header is sent', async () => {
      await expect(
        runUpdate('checkout.template.update', { id: TEMPLATE_ID, status: 'draft' }, null),
      ).rejects.toThrow(FLUSH_SENTINEL)
    })
  })

  // QA round-6 (#2055): a stale DELETE after a conflict still deleted the
  // record because the delete commands did not enforce the lock. These guard
  // that the header now produces a 409 on a stale delete.
  describe('checkout.link.delete', () => {
    beforeEach(() => {
      mockFindOneWithDecryption.mockResolvedValue(linkRecord())
    })

    it('rejects a stale expected version with a structured 409 conflict', async () => {
      expect.assertions(3)
      try {
        await runUpdate('checkout.link.delete', { id: LINK_ID }, STALE_VERSION)
      } catch (error) {
        const httpError = error as { status?: number; body?: Record<string, unknown> }
        expect(httpError.status).toBe(409)
        expect(httpError.body?.code).toBe('optimistic_lock_conflict')
        expect(mockEm.flush).not.toHaveBeenCalled()
      }
    })

    it('passes the lock guard when the expected version matches', async () => {
      await expect(
        runUpdate('checkout.link.delete', { id: LINK_ID }, CURRENT_VERSION),
      ).rejects.toThrow(FLUSH_SENTINEL)
    })

    it('passes the lock guard when no expected-version header is sent (strictly additive)', async () => {
      await expect(
        runUpdate('checkout.link.delete', { id: LINK_ID }, null),
      ).rejects.toThrow(FLUSH_SENTINEL)
    })
  })

  describe('checkout.template.delete', () => {
    beforeEach(() => {
      mockFindOneWithDecryption.mockResolvedValue(templateRecord())
    })

    it('rejects a stale expected version with a structured 409 conflict', async () => {
      expect.assertions(3)
      try {
        await runUpdate('checkout.template.delete', { id: TEMPLATE_ID }, STALE_VERSION)
      } catch (error) {
        const httpError = error as { status?: number; body?: Record<string, unknown> }
        expect(httpError.status).toBe(409)
        expect(httpError.body?.code).toBe('optimistic_lock_conflict')
        expect(mockEm.flush).not.toHaveBeenCalled()
      }
    })

    it('passes the lock guard when the expected version matches', async () => {
      await expect(
        runUpdate('checkout.template.delete', { id: TEMPLATE_ID }, CURRENT_VERSION),
      ).rejects.toThrow(FLUSH_SENTINEL)
    })

    it('passes the lock guard when no expected-version header is sent', async () => {
      await expect(
        runUpdate('checkout.template.delete', { id: TEMPLATE_ID }, null),
      ).rejects.toThrow(FLUSH_SENTINEL)
    })
  })

  // Phase 6b part B: the commands now call the async DI-aware seam
  // `enforceCommandOptimisticLockWithGuards`. These prove the seam behaves like
  // the OSS floor when disabled / OSS-only, and is fail-closed for the
  // enterprise enrichment.
  describe('async command seam (record_locks Phase 6b)', () => {
    beforeEach(() => {
      mockFindOneWithDecryption.mockResolvedValue(linkRecord())
    })

    it('OM_OPTIMISTIC_LOCK=off disables the guard — stale version is not blocked', async () => {
      process.env.OM_OPTIMISTIC_LOCK = 'off'
      await expect(
        runUpdate('checkout.link.update', { id: LINK_ID, status: 'draft' }, STALE_VERSION),
      ).rejects.toThrow(FLUSH_SENTINEL)
    })

    it('OSS-only build (no enterprise guard registered) still enforces the OSS floor 409', async () => {
      expect.assertions(2)
      try {
        // guardService omitted → container throws "not registered" → OSS floor only.
        await runUpdate('checkout.link.update', { id: LINK_ID, status: 'draft' }, STALE_VERSION)
      } catch (error) {
        const httpError = error as { status?: number; body?: Record<string, unknown> }
        expect(httpError.status).toBe(409)
        expect(mockEm.flush).not.toHaveBeenCalled()
      }
    })

    it('awaits the enterprise guard after the floor passes; its 409 blocks the write', async () => {
      expect.assertions(2)
      const conflict = new CrudHttpError(409, { code: 'record_lock_conflict' })
      const guardService = { enforce: jest.fn(async () => { throw conflict }) }
      try {
        await runUpdate('checkout.link.update', { id: LINK_ID, status: 'draft' }, CURRENT_VERSION, guardService)
      } catch (error) {
        expect((error as { status?: number }).status).toBe(409)
        expect(mockEm.flush).not.toHaveBeenCalled()
      }
    })

    it('a non-conflict error from the enterprise guard degrades to OSS-only (write proceeds to flush)', async () => {
      const guardService = { enforce: jest.fn(async () => { throw new Error('guard exploded') }) }
      await expect(
        runUpdate('checkout.link.update', { id: LINK_ID, status: 'draft' }, CURRENT_VERSION, guardService),
      ).rejects.toThrow(FLUSH_SENTINEL)
    })
  })
})
