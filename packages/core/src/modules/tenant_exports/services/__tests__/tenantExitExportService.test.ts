import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildTenantTableSelection,
  isSensitiveTenantExportColumn,
  normalizeTenantExportValue,
  sanitizeTenantExportFileName,
  TenantExitExportService,
} from '../tenantExitExportService'

describe('tenant exit export helpers', () => {
  it('builds a fail-closed tenant and organization predicate', () => {
    expect(buildTenantTableSelection(
      'orders',
      { columns: ['id', 'tenant_id', 'organization_id'], primaryKey: ['id'] },
      'tenant-1',
      ['org-1'],
    )).toEqual({
      where: '("tenant_id" = ? OR ("tenant_id" IS NULL AND "organization_id"::text = ANY(?::text[])))',
      params: ['tenant-1', ['org-1']],
    })
    expect(buildTenantTableSelection(
      'global_settings',
      { columns: ['id'], primaryKey: ['id'] },
      'tenant-1',
      ['org-1'],
    )).toBeNull()
  })

  it('redacts authentication material without dropping usage counters', () => {
    expect(isSensitiveTenantExportColumn('password_hash')).toBe(true)
    expect(isSensitiveTenantExportColumn('refresh_token')).toBe(true)
    expect(isSensitiveTenantExportColumn('credentials')).toBe(true)
    expect(isSensitiveTenantExportColumn('input_tokens')).toBe(false)
    expect(isSensitiveTenantExportColumn('email_hash')).toBe(false)
  })

  it('normalizes non-JSON values deterministically', () => {
    expect(normalizeTenantExportValue({
      z: 3n,
      a: new Date('2026-08-24T10:00:00.000Z'),
      binary: Buffer.from('ok'),
    })).toEqual({
      a: '2026-08-24T10:00:00.000Z',
      binary: { encoding: 'base64', value: 'b2s=' },
      z: '3',
    })
  })

  it('prevents attachment names from escaping their export directory', () => {
    expect(sanitizeTenantExportFileName('../../private report.pdf')).toBe('private_report.pdf')
    expect(sanitizeTenantExportFileName('..')).toBe('attachment.bin')
  })
})

describe('TenantExitExportService archive publication', () => {
  it('publishes the staged package and returns aggregate counts', async () => {
    const executed: string[] = []
    const connection = {
      async execute<T>(sql: string): Promise<T> {
        executed.push(sql)
        if (sql.includes('from "tenants"')) return [{ id: 'tenant-1' }] as T
        if (sql.includes('from "organizations"')) return [] as T
        if (sql.includes('information_schema.columns')) {
          return [
            { table_name: 'tenants', column_name: 'id' },
            { table_name: 'tenants', column_name: 'name' },
          ] as T
        }
        if (sql.includes("constraint_type = 'PRIMARY KEY'")) {
          return [{ table_name: 'tenants', column_name: 'id', ordinal_position: 1 }] as T
        }
        if (sql.includes("constraint_type = 'FOREIGN KEY'")) return [] as T
        if (sql.includes('from "custom_field_defs"')) return [] as T
        if (sql.includes('select "id"::text as "id" from "tenants"')) return [{ id: 'tenant-1' }] as T
        if (sql.includes('select * from "tenants"')) return [{ id: 'tenant-1', name: 'Tenant' }] as T
        if (sql.startsWith('set transaction')) return undefined as T
        throw new Error(`Unexpected SQL: ${sql}`)
      },
    }
    const em = {
      getMetadata: () => ({ getAll: () => new Map() }),
      getConnection: () => connection,
      transactional: async <T>(callback: (transactionalEm: unknown) => Promise<T>) => callback(em),
    }
    let archivedManifest = ''
    const testRoot = await mkdtemp(join(tmpdir(), 'tenant-exit-export-test-'))
    const outputPath = join(testRoot, 'tenant-exit.tar.gz')
    const service = new TenantExitExportService({
      archiveWriter: async (sourceDir, archivePath) => {
        archivedManifest = await readFile(join(sourceDir, 'manifest.json'), 'utf8')
        await mkdir(join(archivePath, '..'), { recursive: true })
        await writeFile(archivePath, 'archive')
      },
      em: em as never,
      now: () => new Date('2026-08-24T10:00:00.000Z'),
    })

    try {
      await expect(service.export({ actor: 'operator-1', outputPath, tenantId: 'tenant-1' })).resolves.toEqual({
        attachmentCount: 0,
        missingAttachmentCount: 0,
        outputPath,
        rowCount: 1,
        tableCount: 1,
      })
      expect(JSON.parse(archivedManifest)).toMatchObject({
        actor: 'operator-1',
        format: 'open-mercato.tenant-exit',
        scope: { tenantId: 'tenant-1' },
        version: 1,
      })
      expect(executed.some((sql) => sql.startsWith('set transaction'))).toBe(true)
    } finally {
      await rm(testRoot, { force: true, recursive: true })
    }
  })
})
