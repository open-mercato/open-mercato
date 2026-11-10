/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext, CommandUndoLogEntry } from '@open-mercato/shared/lib/commands/types'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const ORG_ID = '123e4567-e89b-12d3-a456-426614174000'
const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const FOREIGN_ORG_ID = '123e4567-e89b-12d3-a456-426614174100'
const FOREIGN_TENANT_ID = '123e4567-e89b-12d3-a456-426614174101'
const RECORD_ID = '123e4567-e89b-12d3-a456-426614174010'

const LOOKUP_SENTINEL = 'LOOKUP_REACHED'

const mockFindOneWithDecryption = jest.fn()
const mockSetCustomFieldsIfAny = jest.fn(async () => undefined)

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
  findWithDecryption: jest.fn(async () => []),
}))

jest.mock('../../lib/gatewayProviderAvailability', () => ({
  ensureGatewayProviderConfigured: jest.fn(async () => undefined),
  getGatewayProviderConfigurationMessageKey: jest.fn(() => null),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  setCustomFieldsIfAny: jest.fn((...args: unknown[]) => mockSetCustomFieldsIfAny(...(args as []))),
}))

jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => ({
  loadCustomFieldSnapshot: jest.fn(async () => ({})),
  buildCustomFieldResetMap: jest.fn(() => ({ field: null })),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(async () => ({})),
}))

jest.mock('../../events', () => ({
  emitCheckoutEvent: jest.fn(async () => undefined),
}))

import '../links'
import '../templates'

const mockEm = {
  findOne: jest.fn(async () => {
    throw new Error(LOOKUP_SENTINEL)
  }),
  flush: jest.fn(async () => undefined),
}

function makeContext(allowedIds: string[] | null = [ORG_ID]): CommandRuntimeContext {
  return {
    container: {
      resolve: (token: string) => {
        if (token === 'em') return mockEm
        if (token === 'dataEngine') return {}
        return null
      },
    } as unknown as CommandRuntimeContext['container'],
    auth: { sub: 'user-1', orgId: ORG_ID, tenantId: TENANT_ID } as CommandRuntimeContext['auth'],
    organizationScope: {
      selectedId: ORG_ID,
      filterIds: [ORG_ID],
      allowedIds,
      tenantId: TENANT_ID,
    },
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
  }
}

function snapshot(organizationId: string, tenantId: string) {
  return { id: RECORD_ID, organizationId, tenantId, slug: 'pay-link', custom: { field: 'value' } }
}

function logEntryFor(key: 'before' | 'after', organizationId: string, tenantId: string): CommandUndoLogEntry {
  return { commandPayload: { undo: { [key]: snapshot(organizationId, tenantId) } } }
}

type Case = { commandId: string; mode: 'undo' | 'redo'; key: 'before' | 'after'; lookup: 'em' | 'decryption' }

const CASES: Case[] = [
  { commandId: 'checkout.link.create', mode: 'undo', key: 'after', lookup: 'em' },
  { commandId: 'checkout.link.create', mode: 'redo', key: 'after', lookup: 'decryption' },
  { commandId: 'checkout.link.update', mode: 'undo', key: 'before', lookup: 'em' },
  { commandId: 'checkout.link.delete', mode: 'undo', key: 'before', lookup: 'em' },
  { commandId: 'checkout.template.create', mode: 'undo', key: 'after', lookup: 'em' },
  { commandId: 'checkout.template.create', mode: 'redo', key: 'after', lookup: 'decryption' },
  { commandId: 'checkout.template.update', mode: 'undo', key: 'before', lookup: 'em' },
  { commandId: 'checkout.template.delete', mode: 'undo', key: 'before', lookup: 'em' },
]

async function runHandler(testCase: Case, logEntry: CommandUndoLogEntry, ctx: CommandRuntimeContext = makeContext()) {
  const handler = commandRegistry.get(testCase.commandId)
  const run = testCase.mode === 'undo' ? handler?.undo : handler?.redo
  if (!run) throw new Error(`[internal] ${testCase.commandId} has no ${testCase.mode} handler`)
  return run({ input: {}, ctx, logEntry } as never)
}

function lookupMock(testCase: Case) {
  return testCase.lookup === 'em' ? mockEm.findOne : mockFindOneWithDecryption
}

function lookupWhere(testCase: Case): Record<string, unknown> {
  const calls = lookupMock(testCase).mock.calls as unknown[][]
  return calls[0][testCase.lookup === 'em' ? 1 : 2] as Record<string, unknown>
}

describe('checkout undo/redo tenant scoping (#3831)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindOneWithDecryption.mockImplementation(async () => {
      throw new Error(LOOKUP_SENTINEL)
    })
  })

  describe.each(CASES)('$commandId $mode', (testCase) => {
    it('scopes the record lookup to the snapshot organization and tenant', async () => {
      await expect(runHandler(testCase, logEntryFor(testCase.key, ORG_ID, TENANT_ID))).rejects.toThrow(LOOKUP_SENTINEL)

      expect(lookupMock(testCase)).toHaveBeenCalledTimes(1)
      expect(lookupWhere(testCase)).toMatchObject({ id: RECORD_ID, organizationId: ORG_ID, tenantId: TENANT_ID })
    })

    it('lets a caller with unrestricted organization visibility act on another organization of the same tenant', async () => {
      await expect(
        runHandler(testCase, logEntryFor(testCase.key, FOREIGN_ORG_ID, TENANT_ID), makeContext(null)),
      ).rejects.toThrow(LOOKUP_SENTINEL)

      expect(lookupWhere(testCase)).toMatchObject({ id: RECORD_ID, organizationId: FOREIGN_ORG_ID, tenantId: TENANT_ID })
    })

    it('rejects a snapshot from another tenant before touching any record', async () => {
      const error = await runHandler(testCase, logEntryFor(testCase.key, ORG_ID, FOREIGN_TENANT_ID)).catch((err: unknown) => err)

      expect(error).toBeInstanceOf(CrudHttpError)
      expect(error).toMatchObject({ status: 403 })
      expect(lookupMock(testCase)).not.toHaveBeenCalled()
      expect(mockSetCustomFieldsIfAny).not.toHaveBeenCalled()
      expect(mockEm.flush).not.toHaveBeenCalled()
    })

    it('rejects a snapshot from an organization outside the caller scope', async () => {
      await expect(runHandler(testCase, logEntryFor(testCase.key, FOREIGN_ORG_ID, TENANT_ID))).rejects.toMatchObject({ status: 403 })
      expect(lookupMock(testCase)).not.toHaveBeenCalled()
      expect(mockSetCustomFieldsIfAny).not.toHaveBeenCalled()
      expect(mockEm.flush).not.toHaveBeenCalled()
    })
  })
})
