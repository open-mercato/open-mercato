import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import sharp from 'sharp'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { uploadAttachmentFixture } from '@open-mercato/core/helpers/integration/attachmentsFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const configurations = [
  { name: 'blank driver', driver: '', config: {}, reason: 'driver_missing' },
  { name: 'unknown driver', driver: 'integration-unregistered', config: {}, reason: 'unknown_driver' },
  { name: 'array config', driver: 'local', config: [], reason: 'invalid_config' },
  { name: 'scalar config', driver: 'local', config: 42, reason: 'invalid_config' },
] as const

test.describe('TC-ATT-015: Stored partition validation preserves attachment data', () => {
  for (const configuration of configurations) {
    test(`should enforce the configured storage policy for ${configuration.name}`, async ({ request }) => {
      expect(process.env.DATABASE_URL?.trim(), 'Native integration runner must provide its database').toBeTruthy()
      const token = await getAuthToken(request)
      const scope = getTokenScope(token)
      expect(scope.tenantId).toBeTruthy()
      expect(scope.organizationId).toBeTruthy()
      const partitionId = randomUUID()
      const code = `storage_${randomUUID().replaceAll('-', '')}`
      const recordId = randomUUID()
      const strict = process.env.OM_ATTACHMENT_STORAGE_POLICY?.trim() === 'strict'
      const buffer = await sharp({
        create: { width: 2, height: 2, channels: 4, background: { r: 30, g: 80, b: 110, alpha: 1 } },
      }).png().toBuffer()
      let attachmentId: string | null = null

      await withClient(async (client) => {
        await client.query(
          `insert into attachment_partitions
            (id, code, title, storage_driver, config_json, is_public, requires_ocr,
             tenant_id, organization_id, created_at, updated_at)
           values ($1, $2, $3, 'local', '{}'::jsonb, false, false, $4, $5, now(), now())`,
          [partitionId, code, 'Storage policy integration fixture', scope.tenantId, scope.organizationId],
        )
      })

      try {
        const uploaded = await uploadAttachmentFixture(request, token, {
          entityId: 'attachments:library', recordId, partitionCode: code,
          fileName: 'storage.png', mimeType: 'image/png', buffer,
        })
        attachmentId = uploaded.id
        expect(uploaded.partitionCode, 'The upload must use this test partition').toBe(code)
        const fixtureRows = await withClient((client) => client.query<{ id: string }>(
          'select id from attachments where id = $1 and partition_code = $2', [attachmentId, code],
        ))
        expect(fixtureRows.rows.map((row) => row.id), 'API and DB fixtures must use the same database').toEqual([attachmentId])
        const paths = [
          `/api/attachments/file/${attachmentId}`,
          `/api/attachments/image/${attachmentId}?width=1`,
        ]
        for (const path of paths) {
          const response = await apiRequest(request, 'GET', path, { token })
          expect(response.status(), `Explicit local storage: ${path}`).toBe(200)
          expect((await response.body()).byteLength).toBeGreaterThan(0)
        }

        await withClient(async (client) => {
          await client.query(
            'update attachment_partitions set storage_driver = $2, config_json = $3::jsonb where id = $1',
            [partitionId, configuration.driver, JSON.stringify(configuration.config)],
          )
        })

        for (const path of paths) {
          const response = await apiRequest(request, 'GET', path, { token })
          expect(response.status(), `Stored configuration: ${path}`).toBe(strict ? 503 : 200)
          if (strict) {
            expect(await readJsonSafe(response)).toMatchObject({
              code: 'ATTACHMENT_STORAGE_CONFIGURATION_INVALID', reason: configuration.reason,
            })
          }
        }

        if (strict) {
          for (const path of [
            `/api/attachments?id=${attachmentId}`,
            `/api/attachments/library/${attachmentId}`,
          ]) {
            const response = await apiRequest(request, 'DELETE', path, { token })
            expect(response.status(), `Deletion must fail before side effects: ${path}`).toBe(503)
            expect(await readJsonSafe(response)).toMatchObject({
              code: 'ATTACHMENT_STORAGE_CONFIGURATION_INVALID', reason: configuration.reason,
            })
          }
          const rejectedUpload = await request.post('/api/attachments', {
            headers: { Authorization: `Bearer ${token}` },
            multipart: {
              entityId: 'attachments:library', recordId, partitionCode: code,
              file: { name: 'rejected.png', mimeType: 'image/png', buffer },
            },
          })
          expect(rejectedUpload.status()).toBe(503)
          expect(await readJsonSafe(rejectedUpload)).toMatchObject({
            code: 'ATTACHMENT_STORAGE_CONFIGURATION_INVALID', reason: configuration.reason,
          })
          const records = await withClient((client) => client.query<{ total: number }>(
            'select count(*)::int as total from attachments where partition_code = $1', [code],
          ))
          expect(records.rows[0]?.total).toBe(1)
        }

        const detail = await apiRequest(request, 'GET', `/api/attachments/library/${attachmentId}`, { token })
        expect(detail.status(), 'Rejected storage operations must retain metadata').toBe(200)
        await withClient((client) => client.query(
          "update attachment_partitions set storage_driver = 'local', config_json = '{}'::jsonb where id = $1",
          [partitionId],
        ))
        const restored = await apiRequest(request, 'GET', `/api/attachments/file/${attachmentId}`, { token })
        expect(restored.status()).toBe(200)
        expect(await restored.body(), 'Rejected deletes must preserve original bytes').toEqual(buffer)
      } finally {
        await withClient((client) => client.query(
          "update attachment_partitions set storage_driver = 'local', config_json = '{}'::jsonb where id = $1",
          [partitionId],
        ))
        const fixtureRows = await withClient((client) => client.query<{ id: string }>(
          'select id from attachments where partition_code = $1', [code],
        ))
        const fixtureIds = new Set(fixtureRows.rows.map((row) => row.id))
        if (attachmentId) fixtureIds.add(attachmentId)
        const cleanupStatuses: number[] = []
        for (const fixtureId of fixtureIds) {
          const removed = await apiRequest(request, 'DELETE', `/api/attachments?id=${fixtureId}`, { token })
          cleanupStatuses.push(removed.status())
        }
        const remaining = await withClient((client) => client.query<{ total: number }>(
          'select count(*)::int as total from attachments where partition_code = $1', [code],
        ))
        expect(remaining.rows[0]?.total, 'Keep the partition available if file cleanup fails').toBe(0)
        await withClient((client) => client.query('delete from attachment_partitions where id = $1', [partitionId]))
        expect(cleanupStatuses, 'Every fixture attachment should be deleted').toEqual(cleanupStatuses.map(() => 200))
      }
    })
  }
})
