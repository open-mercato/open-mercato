import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { APIRequestContext } from '@playwright/test'
import { createModuleQueue, type Queue } from '@open-mercato/queue'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import { getTokenContext } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

/**
 * A queue that is registered by a module worker (so the dashboard lists it) and that the CI
 * harness never drains (no worker process runs there), so jobs enqueued here stay inspectable.
 */
export const QUEUE_STATUS_TEST_QUEUE = 'customers-deals-bulk-update-owner'

const TEST_APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
const APP_ROOT = TEST_APP_ROOT ? path.resolve(TEST_APP_ROOT) : path.resolve(process.cwd(), 'apps/mercato')

if (!TEST_APP_ROOT && !process.env.QUEUE_BASE_DIR) {
  // The local strategy keeps its files under the app root; the server under test reads the same directory.
  process.env.QUEUE_BASE_DIR = path.resolve(APP_ROOT, '.mercato/queue')
}

/** Uses whichever strategy the harness runs (`QUEUE_STRATEGY`), so the same spec covers local and async. */
export function openTestQueue(): Queue<Record<string, unknown>> {
  return createModuleQueue<Record<string, unknown>>(QUEUE_STATUS_TEST_QUEUE)
}

export function uniqueMarker(prefix: string): string {
  return `${prefix}-${randomUUID()}`
}

/** Removes jobs these specs enqueued, whatever tenant they claimed. */
export async function cleanupTestJobs(queue: Queue<Record<string, unknown>>, tenantIds: string[]): Promise<void> {
  for (const tenantId of tenantIds) {
    await queue.removeQueuedJobsByScope?.({ tenantId }).catch(() => undefined)
  }
  await queue.close().catch(() => undefined)
}

export type InspectorUserFixture = {
  token: string
  tenantId: string
  organizationId: string
  cleanup: () => Promise<void>
}

/**
 * A tenant-scoped (non-superadmin) user holding `configs.queues_status.inspect_payloads`.
 * The role ACL is written by the superadmin because an admin cannot grant a feature it lacks.
 */
export async function createInspectorUser(request: APIRequestContext, label: string): Promise<InspectorUserFixture> {
  const superadminToken = await getAuthToken(request, 'superadmin')
  const adminToken = await getAuthToken(request, 'admin')
  const { tenantId, organizationId } = getTokenContext(adminToken)
  const stamp = uniqueMarker(label)
  const email = `${stamp}@example.com`
  const password = 'Valid1!Pass-queue-status'
  let roleId: string | null = null
  let userId: string | null = null
  try {
    roleId = await createRoleFixture(request, superadminToken, { name: `qs-inspector-${stamp}`, tenantId })
    await setRoleAclFeatures(request, superadminToken, {
      roleId,
      features: ['configs.queues_status.view', 'configs.queues_status.inspect_payloads'],
    })
    userId = await createUserFixture(request, superadminToken, { email, password, organizationId, roles: [roleId] })
  } catch (error) {
    await deleteUserIfExists(request, superadminToken, userId)
    await deleteRoleIfExists(request, superadminToken, roleId)
    throw error
  }
  const token = await getAuthToken(request, email, password)
  return {
    token,
    tenantId,
    organizationId,
    cleanup: async () => {
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteRoleIfExists(request, superadminToken, roleId)
    },
  }
}
