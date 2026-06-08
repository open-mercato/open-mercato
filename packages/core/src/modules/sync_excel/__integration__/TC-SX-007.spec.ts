import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { config as loadEnv } from 'dotenv'
import { Client } from 'pg'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  ENTITY_TYPE,
  INTEGRATION_ID,
  buildValidMapping,
  decodeTokenScope,
  readJson,
  startImport,
  uploadSampleCsv,
} from './helpers/syncExcel'

// Match TC-SX-001: when not running under the integration runner (which injects
// DATABASE_URL), load it from apps/mercato/.env so a manual single-spec run works.
if (!process.env.OM_TEST_APP_ROOT?.trim()) {
  loadEnv({ path: path.resolve(process.cwd(), 'apps/mercato', '.env') })
}

/**
 * TC-SX-007: Import endpoint detects concurrent import conflicts (409).
 *
 * Source: GitHub issue #2493 (sync_excel coverage expansion).
 *
 * The import route calls `findRunningOverlap('sync_excel', 'customers.person',
 * 'import', scope)` and returns 409 'A sync_excel import is already in progress
 * for this entity type.' when a run in `pending`/`running` state exists for that
 * scope. The 409 is returned before the route persists the mapping or starts a
 * run (overlap check precedes the write transaction).
 *
 * Determinism: the integration runner enables `AUTO_SPAWN_WORKERS`, so a real
 * import started via the API would be picked up and completed by the
 * data-sync-import worker, turning the conflict into a timing race. Instead this
 * test seeds an in-progress `sync_runs` row directly with NO queue job — the
 * worker never touches it, so it stays in-progress until the test removes it.
 * This mirrors TC-SX-001's pg-based run lifecycle handling and requires
 * `DATABASE_URL` (provided by the integration runner).
 *
 * Scope note: the complementary "conflict clears after the run finishes" path is
 * intentionally not asserted here — proving it requires a real worker-processed
 * import, which is nondeterministic and mutates shared mapping/customer state.
 */
test.describe('TC-SX-007: sync_excel import concurrency conflict', () => {
  test('returns 409 when an import for the same entity type is already in progress', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = decodeTokenScope(token)

    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error('DATABASE_URL is required for TC-SX-007 to seed an in-progress sync run')
    }
    const dbClient = new Client({ connectionString })
    await dbClient.connect()

    // A valid upload is required for the import to reach the overlap check.
    const upload = await uploadSampleCsv(request, token, 'sx-concurrency')
    const overlapRunId = randomUUID()

    try {
      await dbClient.query(
        `insert into sync_runs (id, integration_id, entity_type, direction, status, organization_id, tenant_id, created_at, updated_at)
         values ($1, $2, $3, 'import', 'running', $4, $5, now(), now())`,
        [overlapRunId, INTEGRATION_ID, ENTITY_TYPE, scope.orgId, scope.tenantId],
      )

      const conflict = await startImport(request, token, {
        uploadId: String(upload.uploadId),
        entityType: ENTITY_TYPE,
        mapping: buildValidMapping(),
      })

      expect(conflict.status()).toBe(409)
      expect(String((await readJson(conflict)).error)).toContain('already in progress')
    } finally {
      await dbClient
        .query(
          `update sync_runs set status = 'cancelled', updated_at = now()
           where integration_id = $1 and entity_type = $2 and direction = 'import'
             and status in ('pending', 'running') and organization_id = $3 and tenant_id = $4 and deleted_at is null`,
          [INTEGRATION_ID, ENTITY_TYPE, scope.orgId, scope.tenantId],
        )
        .catch(() => undefined)
      await dbClient.end().catch(() => undefined)
    }
  })
})
