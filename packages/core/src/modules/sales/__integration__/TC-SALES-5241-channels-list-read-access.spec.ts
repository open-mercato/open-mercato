import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

/**
 * TC-SALES-5241: who can read the sales channels list.
 *
 * `GET /api/sales/channels` is gated on `sales.channels.view` (writes stay on
 * `sales.channels.manage`). The orders list resolves channel uuids to names through this
 * endpoint, so the gate decides whether an operator sees channel names or raw uuids.
 *
 * The three role shapes below are the ones that behave differently, and the reason this is an
 * integration test rather than a metadata assertion: `dependsOn` in `acl.ts` is advisory
 * metadata for the role editor, not a runtime grant. `RbacService.userHasAllFeatures` resolves
 * the stored grant list and understands wildcards only — there is no dependency closure — so
 * holding a feature that *depends on* `sales.channels.view` does not confer it.
 *
 * Pinned behaviour:
 *  - `sales.channels.view` → 200. This is the fix; it fails if the gate reverts to `manage`.
 *  - `sales.orders.view` alone → 403, despite `sales.orders.view` declaring
 *    `dependsOn: ['sales.channels.view']`. Pins the advisory-only semantics, so making
 *    dependencies runtime-transitive later has to update this test deliberately.
 *  - `sales.channels.manage` without `view` → 403. Pins the access loss the gate change
 *    introduces for that role shape, so the decision lives in a test rather than a thread.
 *
 * Writes are asserted to still require `manage`, which is the regression that would turn a read
 * relaxation into a security defect.
 *
 * Self-contained: creates its own roles and users per test and removes them in `finally`.
 */

const CHANNELS_PATH = '/api/sales/channels'

// The non-channel dependencies of `sales.orders.view`. Granted so the orders-only role is a
// realistic least-privilege shape rather than a feature list that could not exist in practice.
const ORDERS_VIEW_COMPANIONS = [
  'sales.orders.view',
  'sales.settings.view',
  'customers.people.view',
  'catalog.products.view',
  'currencies.view',
]

type JsonRecord = Record<string, unknown>

async function readJson(response: APIResponse): Promise<JsonRecord> {
  const raw = await response.text()
  if (!raw) return {}
  try {
    return JSON.parse(raw) as JsonRecord
  } catch {
    return {}
  }
}

function requiredFeatures(body: JsonRecord): string[] {
  return Array.isArray(body.requiredFeatures) ? (body.requiredFeatures as string[]) : []
}

type Subject = {
  token: string
  roleId: string
  userId: string
}

async function createSubject(
  request: APIRequestContext,
  adminToken: string,
  input: { label: string; slug: string; features: string[] },
): Promise<Subject> {
  const scope = getTokenScope(adminToken)
  const stamp = `${Date.now()}-${Math.round(process.hrtime()[1] / 1000)}`
  const email = `qa-${input.slug}-${stamp}@acme.com`
  const password = `QaChannels1!${stamp}`

  const roleId = await createRoleFixture(request, adminToken, {
    name: `QA ${input.label} ${stamp}`,
    tenantId: scope.tenantId ?? undefined,
  })
  await setRoleAclFeatures(request, adminToken, { roleId, features: input.features })
  const userId = await createUserFixture(request, adminToken, {
    email,
    password,
    organizationId: scope.organizationId!,
    roles: [roleId],
    name: `QA ${input.label} ${stamp}`,
  })

  return { token: await getAuthToken(request, email, password), roleId, userId }
}

async function destroySubject(
  request: APIRequestContext,
  adminToken: string | null,
  subject: Subject | null,
): Promise<void> {
  if (!adminToken || !subject) return
  await deleteUserIfExists(request, adminToken, subject.userId)
  await deleteRoleIfExists(request, adminToken, subject.roleId)
}

test.describe('TC-SALES-5241: sales channels list read access', () => {
  test('a role holding sales.channels.view can list channels', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let subject: Subject | null = null
    let channelId: string | null = null

    try {
      const created = await apiRequest(request, 'POST', CHANNELS_PATH, {
        token: adminToken,
        data: { name: `QA Channel Viewer Target ${stamp}`, code: `qa-view-${stamp}` },
      })
      expect(created.status(), 'channel fixture create should be 201').toBe(201)
      channelId = expectId((await readJsonSafe<{ id?: string }>(created))?.id, 'channel fixture should return an id')

      subject = await createSubject(request, adminToken, {
        label: 'Channel Viewer',
        slug: 'channels-viewer',
        features: [...ORDERS_VIEW_COMPANIONS, 'sales.channels.view'],
      })

      const list = await apiRequest(request, 'GET', CHANNELS_PATH, { token: subject.token })
      expect(list.status(), 'channel viewer GET /api/sales/channels should be 200').toBe(200)

      const items = ((await readJson(list)).items ?? []) as Array<{ id?: string; name?: string }>
      const match = items.find((item) => item?.id === channelId)
      expect(match, 'the viewer should see the fixture channel in the list').toBeTruthy()
      expect(match?.name, 'the list should carry the channel name the orders list renders').toBe(
        `QA Channel Viewer Target ${stamp}`,
      )
    } finally {
      if (channelId) {
        await apiRequest(request, 'DELETE', `${CHANNELS_PATH}?id=${encodeURIComponent(channelId)}`, {
          token: adminToken,
        }).catch(() => undefined)
      }
      await destroySubject(request, adminToken, subject)
    }
  })

  test('sales.channels.view does not grant writes', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    let subject: Subject | null = null

    try {
      subject = await createSubject(request, adminToken, {
        label: 'Channel Viewer NoWrite',
        slug: 'channels-viewer-nowrite',
        features: [...ORDERS_VIEW_COMPANIONS, 'sales.channels.view'],
      })

      const create = await apiRequest(request, 'POST', CHANNELS_PATH, {
        token: subject.token,
        data: { name: `QA blocked ${Date.now()}`, code: `qa-blocked-${Date.now()}` },
      })
      expect(create.status(), 'channel viewer POST /api/sales/channels should be 403').toBe(403)
      expect(requiredFeatures(await readJson(create)), '403 should cite the write feature').toContain(
        'sales.channels.manage',
      )
    } finally {
      await destroySubject(request, adminToken, subject)
    }
  })

  // `sales.orders.view` declares `dependsOn: ['sales.channels.view']`, but dependsOn is advisory
  // metadata rendered by the role editor — it is never expanded into a grant at runtime. This
  // test exists so that changing that is a deliberate act.
  test('sales.orders.view alone does not confer sales.channels.view', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    let subject: Subject | null = null

    try {
      subject = await createSubject(request, adminToken, {
        label: 'Orders Only',
        slug: 'orders-only',
        features: ORDERS_VIEW_COMPANIONS,
      })

      const list = await apiRequest(request, 'GET', CHANNELS_PATH, { token: subject.token })
      expect(list.status(), 'orders-only GET /api/sales/channels should be 403').toBe(403)
      expect(requiredFeatures(await readJson(list)), '403 should cite the read feature').toContain(
        'sales.channels.view',
      )
    } finally {
      await destroySubject(request, adminToken, subject)
    }
  })

  // The access loss introduced by moving the read gate to `view`. Recorded rather than argued:
  // if maintainers decide a channel administrator should keep list access, this expectation is
  // the thing that has to change, which makes the decision explicit.
  test('sales.channels.manage without sales.channels.view cannot list channels', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    let subject: Subject | null = null

    try {
      subject = await createSubject(request, adminToken, {
        label: 'Channel Manager NoView',
        slug: 'channels-manager-noview',
        features: [...ORDERS_VIEW_COMPANIONS, 'sales.channels.manage'],
      })

      const list = await apiRequest(request, 'GET', CHANNELS_PATH, { token: subject.token })
      expect(list.status(), 'manage-without-view GET /api/sales/channels should be 403').toBe(403)
      expect(requiredFeatures(await readJson(list)), '403 should cite the read feature').toContain(
        'sales.channels.view',
      )
    } finally {
      await destroySubject(request, adminToken, subject)
    }
  })
})
