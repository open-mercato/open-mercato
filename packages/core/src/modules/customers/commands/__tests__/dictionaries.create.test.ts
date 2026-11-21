import { asValue, createContainer } from 'awilix'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { OPTIMISTIC_LOCK_ENV_VAR, OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { CustomerDictionaryEntryCreateInput } from '../../data/validators'
import { CustomerDictionaryEntry } from '../../data/entities'

const registeredCommands = new Map<string, CommandHandler<CustomerDictionaryEntryCreateInput, unknown>>()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand: (command: CommandHandler<CustomerDictionaryEntryCreateInput, unknown>) => {
    registeredCommands.set(command.id, command)
  },
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

import '../dictionaries'

const tenantId = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'
const savedVersion = '2026-11-20T10:00:00.000Z'
const input = { tenantId, organizationId, kind: 'activity_type', value: ' QA Meeting ', label: 'Second edit' } as const
const lookup = { tenantId, organizationId, kind: 'activity_type', normalizedValue: 'qa meeting' }
const scope = { tenantId, organizationId }
const scopedUniqueViolation = { code: '23505', constraint: 'customer_dictionary_entries_unique' }
const find = jest.mocked(findOneWithDecryption)
const command = registeredCommands.get('customers.dictionaryEntries.create')!

function setup(expectedVersion?: string) {
  const row = Object.assign(new CustomerDictionaryEntry(), {
    ...lookup,
    id: '11111111-1111-4111-8111-111111111111',
    value: 'QA Meeting',
    label: 'First edit',
    updatedAt: new Date(savedVersion),
  })
  const freshEm = {}
  const em = {
    create: jest.fn(() => row),
    persist: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    fork: jest.fn(() => freshEm),
  }
  const container = createContainer().register({
    em: asValue({ fork: () => em }),
    cache: asValue(undefined),
  })
  const ctx: CommandRuntimeContext = {
    container,
    auth: null,
    organizationScope: null,
    organizationIds: [organizationId],
    selectedOrganizationId: organizationId,
    request: new Request('https://example.test/api/customers/dictionaries/activity-types', {
      method: 'POST',
      headers: expectedVersion === undefined ? {} : { [OPTIMISTIC_LOCK_HEADER_NAME]: expectedVersion },
    }),
  }
  return { ctx, em, freshEm, row }
}

describe('create activity type dictionary entry', () => {
  beforeEach(() => {
    find.mockReset()
    jest.replaceProperty(process, 'env', { ...process.env, [OPTIMISTIC_LOCK_ENV_VAR]: 'all' })
  })

  afterEach(() => jest.restoreAllMocks())

  it.each([undefined, 'invalid'])('rejects a duplicate POST with version %s before writing', async (version) => {
    const { ctx, em, row } = setup(version)
    find.mockResolvedValueOnce(row)

    await expect(command.execute(input, ctx)).rejects.toMatchObject({
      status: 409,
      body: { error: 'record_modified', code: 'optimistic_lock_conflict', currentUpdatedAt: savedVersion, expectedUpdatedAt: savedVersion },
    })
    expect(row.label).toBe('First edit')
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('creates a local entry with no version when the scoped value is absent', async () => {
    const { ctx, em } = setup()
    find.mockResolvedValueOnce(null)

    await expect(command.execute(input, ctx)).resolves.toMatchObject({ mode: 'created' })
    expect(find).toHaveBeenCalledWith(em, CustomerDictionaryEntry, lookup, {}, scope)
    expect(em.create).toHaveBeenCalledWith(CustomerDictionaryEntry, expect.objectContaining({ ...lookup, label: 'Second edit' }))
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('returns the winning version if a concurrent insert takes the scoped value', async () => {
    const { ctx, em, freshEm, row } = setup()
    find.mockResolvedValueOnce(null).mockResolvedValueOnce(row)
    em.flush.mockRejectedValueOnce(scopedUniqueViolation)

    await expect(command.execute(input, ctx)).rejects.toMatchObject({
      status: 409,
      body: { error: 'record_modified', code: 'optimistic_lock_conflict', currentUpdatedAt: savedVersion, expectedUpdatedAt: savedVersion },
    })
    expect(find).toHaveBeenNthCalledWith(2, freshEm, CustomerDictionaryEntry, lookup, {}, scope)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('propagates a unique violation when it cannot find a winner in scope', async () => {
    const { ctx, em } = setup()
    find.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    em.flush.mockRejectedValueOnce(scopedUniqueViolation)

    await expect(command.execute(input, ctx)).rejects.toBe(scopedUniqueViolation)
  })

  it('does not retry the lookup on an unrelated unique violation', async () => {
    const { ctx, em } = setup()
    const violation = { code: '23505', constraint: 'customer_dictionary_entries_pkey' }
    find.mockResolvedValueOnce(null)
    em.flush.mockRejectedValueOnce(violation)

    await expect(command.execute(input, ctx)).rejects.toBe(violation)
    expect(find).toHaveBeenCalledTimes(1)
  })

  it('rejects a stale version and accepts a matching version', async () => {
    const staleVersion = '2026-11-19T10:00:00.000Z'
    const { ctx, em, row } = setup(staleVersion)
    find.mockResolvedValue(row)

    await expect(command.execute(input, ctx)).rejects.toMatchObject({
      status: 409,
      body: { code: 'optimistic_lock_conflict', currentUpdatedAt: savedVersion, expectedUpdatedAt: staleVersion },
    })
    expect(em.flush).not.toHaveBeenCalled()

    ctx.request?.headers.set(OPTIMISTIC_LOCK_HEADER_NAME, savedVersion)
    await expect(command.execute(input, ctx)).resolves.toMatchObject({ mode: 'updated' })
    expect(row.label).toBe('Second edit')
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('still accepts a versionless duplicate for a fellow dictionary kind', async () => {
    const { ctx, row } = setup()
    row.kind = 'job_title'
    find.mockResolvedValue(row)

    await expect(command.execute({ ...input, kind: 'job_title' }, ctx)).resolves.toMatchObject({ mode: 'updated' })
    expect(row.label).toBe('Second edit')
  })

  it('does not require a version for a command execution without an HTTP request', async () => {
    const { ctx, row } = setup()
    find.mockResolvedValue(row)

    await expect(command.execute(input, { ...ctx, request: undefined })).resolves.toMatchObject({ mode: 'updated' })
  })

  it('honors the optimistic-lock opt-out', async () => {
    process.env[OPTIMISTIC_LOCK_ENV_VAR] = 'off'
    const { ctx, row } = setup()
    find.mockResolvedValue(row)

    await expect(command.execute(input, ctx)).resolves.toMatchObject({ mode: 'updated' })
  })
})
