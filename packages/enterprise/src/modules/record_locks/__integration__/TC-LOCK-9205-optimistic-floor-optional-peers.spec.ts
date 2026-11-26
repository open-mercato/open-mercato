import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  cleanupDictionary,
  createDictionaryEntryFixture,
  createDictionaryFixture,
  getDictionaryEntryUpdatedAt,
  updateDictionaryEntryLabel,
} from './helpers/recordLocks'

export const integrationMeta = { dependsOnModules: ['record_locks', 'dictionaries'] }

/**
 * TC-LOCK-9205: the OSS optimistic-lock floor keeps rejecting stale writes while
 * record_locks is enabled, whether or not its optional peers `configs` and
 * `audit_logs` are (#9205).
 *
 * record_locks overrides `crudMutationGuardService` (which carries the OSS
 * `updated_at` floor) and resolves `recordLockService`; both used to throw an
 * AwilixResolutionError when `configs` or `audit_logs` was disabled, so edit forms
 * could not save and the floor was silently dropped.
 *
 * Normal path (any module set): on a dictionary entry, a write carrying a stale
 * expected `updated_at` (the header `buildOptimisticLockHeader` emits) answers 409
 * with a lock-conflict code, and a write carrying the fresh version succeeds.
 * Absent path (configs or audit_logs disabled): the same stale/fresh contract holds,
 * and GET /api/record_locks/settings still answers 200 with the built-in defaults
 * instead of failing to resolve the service.
 *
 * Record-lock settings are never written, so the spec cannot leak configuration into
 * other specs; it creates its own dictionary and deletes it (cascading the entry).
 */

const CONFLICT_CODES = ['optimistic_lock_conflict', 'record_lock_conflict']

type PeerModules = { configsEnabled: boolean; auditLogsEnabled: boolean }

async function probeModule(request: APIRequestContext, token: string, path: string, moduleId: string): Promise<boolean> {
  const response = await apiRequest(request, 'GET', path, { token })
  expect([200, 404], `${moduleId} probe answered ${response.status()}`).toContain(response.status())
  return response.status() === 200
}

async function probePeerModules(request: APIRequestContext, superadminToken: string): Promise<PeerModules> {
  return {
    configsEnabled: await probeModule(request, superadminToken, '/api/configs/system-status', 'configs'),
    auditLogsEnabled: await probeModule(request, superadminToken, '/api/audit_logs/audit-logs/actions?pageSize=1', 'audit_logs'),
  }
}

async function assertStaleWriteRejectedFreshWriteAccepted(request: APIRequestContext, token: string): Promise<void> {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
  let dictionaryId: string | null = null
  try {
    dictionaryId = await createDictionaryFixture(request, token, {
      key: `qa_lock_9205_${suffix}`,
      name: `QA Lock 9205 ${suffix}`,
    })
    const { entryId } = await createDictionaryEntryFixture(request, token, dictionaryId, {
      value: `qa_9205_${suffix}`,
      label: `QA 9205 ${suffix}`,
    })

    const baseUpdatedAt = await getDictionaryEntryUpdatedAt(request, token, dictionaryId, entryId)
    expect(baseUpdatedAt, 'the entry list exposes updatedAt').toBeTruthy()

    const incoming = await updateDictionaryEntryLabel(request, token, dictionaryId, entryId, `Incoming ${suffix}`, baseUpdatedAt)
    expect(incoming.status, `a write on the current version succeeds (got ${incoming.status})`).toBeLessThan(300)

    const stale = await updateDictionaryEntryLabel(request, token, dictionaryId, entryId, `Stale ${suffix}`, baseUpdatedAt)
    expect(stale.status, `a write on a stale version is refused (body=${JSON.stringify(stale.body)})`).toBe(409)
    expect(CONFLICT_CODES).toContain(stale.body?.code as string)

    const freshUpdatedAt = await getDictionaryEntryUpdatedAt(request, token, dictionaryId, entryId)
    expect(freshUpdatedAt).toBeTruthy()
    expect(freshUpdatedAt).not.toBe(baseUpdatedAt)

    const resaved = await updateDictionaryEntryLabel(request, token, dictionaryId, entryId, `Resaved ${suffix}`, freshUpdatedAt)
    expect(resaved.status, `a write on the fresh version succeeds (got ${resaved.status})`).toBeLessThan(300)
  } finally {
    await cleanupDictionary(request, token, dictionaryId)
  }
}

test.describe('TC-LOCK-9205: OSS optimistic-lock floor with and without configs/audit_logs', () => {
  test.describe.configure({ timeout: 120_000 })

  test('a stale dictionary-entry write 409s and a fresh one succeeds', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    await probePeerModules(request, superadminToken)
    const adminToken = await getAuthToken(request, 'admin')
    await assertStaleWriteRejectedFreshWriteAccepted(request, adminToken)
  })

  test('without configs or audit_logs the settings resolve to defaults and the floor still holds', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const peers = await probePeerModules(request, superadminToken)
    test.skip(
      peers.configsEnabled && peers.auditLogsEnabled,
      'Requires an app with the optional configs or audit_logs module disabled',
    )

    const settings = await apiRequest(request, 'GET', '/api/record_locks/settings', { token: superadminToken })
    expect(settings.status(), 'recordLockService resolves without its optional peers').toBe(200)
    const settingsBody = await readJsonSafe<{ settings?: { enabled?: boolean; strategy?: string } }>(settings)
    expect(settingsBody?.settings, 'settings fall back to a well-formed record').toBeTruthy()
    if (!peers.configsEnabled) {
      expect(settingsBody?.settings?.strategy, 'configs disabled: the built-in default strategy applies').toBe('optimistic')
    }

    const adminToken = await getAuthToken(request, 'admin')
    await assertStaleWriteRejectedFreshWriteAccepted(request, adminToken)
  })
})
