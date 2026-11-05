import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = join(__dirname, '..', 'migrations')

function readMigration(fileName: string): string {
  return readFileSync(join(migrationsDir, fileName), 'utf8')
}

function upSection(source: string): string {
  const start = source.indexOf('override up()')
  const end = source.indexOf('override down()')
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function downSection(source: string): string {
  const start = source.indexOf('override down()')
  expect(start).toBeGreaterThanOrEqual(0)
  return source.slice(start)
}

describe('documents migration reversibility', () => {
  it('drops the initial schema in reverse dependency order', () => {
    const down = downSection(readMigration('Migration20260708163836_documents.ts'))
    const expectedOrder = [
      'document_versions',
      'document_shares',
      'document_folders',
      'document_contents',
      'document_comments',
      'document_attachments',
      'documents',
    ]

    for (const table of expectedOrder) {
      expect(down).toContain(`drop table if exists "${table}" cascade`)
    }
    for (let index = 1; index < expectedOrder.length; index += 1) {
      expect(down.indexOf(`"${expectedOrder[index - 1]}"`))
        .toBeLessThan(down.indexOf(`"${expectedOrder[index]}"`))
    }
  })

  it('reverts the templates migration before its additive comment column', () => {
    const source = readMigration('Migration20260709164720_documents.ts')
    const up = upSection(source)
    const down = downSection(source)

    expect(up).toContain('create table "document_templates"')
    expect(up).toContain('create index "document_templates_scope_idx"')
    expect(up).toContain('alter table "document_comments" add "mentions"')
    expect(down).toContain('alter table "document_comments" drop column "mentions"')
    expect(down).toContain('drop index if exists "document_templates_scope_idx"')
    expect(down).toContain('drop table if exists "document_templates" cascade')
    expect(down.indexOf('drop column "mentions"'))
      .toBeLessThan(down.indexOf('drop index if exists "document_templates_scope_idx"'))
    expect(down.indexOf('drop index if exists "document_templates_scope_idx"'))
      .toBeLessThan(down.indexOf('drop table if exists "document_templates"'))
  })

  it('reverts the entity-links migration with an idempotent seed-key index drop', () => {
    const source = readMigration('Migration20260710002318_documents.ts')
    const up = upSection(source)
    const down = downSection(source)

    expect(up).toContain('create table "document_entity_links"')
    expect(up).toContain('create unique index "document_templates_active_seed_key_uq"')
    expect(up).toContain('alter table "document_templates" add "seed_key"')
    expect(down).toContain('drop index if exists "document_templates_active_seed_key_uq"')
    expect(down).toContain('alter table "document_templates" drop column "seed_key"')
    expect(down).toContain('drop table if exists "document_entity_links" cascade')
    expect(down.indexOf('drop index if exists "document_templates_active_seed_key_uq"'))
      .toBeLessThan(down.indexOf('drop column "seed_key"'))
    expect(down.indexOf('drop column "seed_key"'))
      .toBeLessThan(down.indexOf('drop table if exists "document_entity_links"'))
  })

  it('reverts the collaboration generation column', () => {
    const source = readMigration('Migration20260710071003_documents.ts')

    expect(upSection(source))
      .toContain('alter table "document_contents" add "collaboration_generation"')
    expect(downSection(source))
      .toContain('alter table "document_contents" drop column "collaboration_generation"')
  })

  it('reverts the documents list sort index idempotently', () => {
    const source = readMigration('Migration20260712120000_documents.ts')

    expect(upSection(source)).toContain(
      'create index "documents_list_sort_idx" on "documents" ("organization_id", "tenant_id", "updated_at") where "deleted_at" is null',
    )
    expect(downSection(source)).toContain('drop index if exists "documents_list_sort_idx"')
  })

  it('enforces and reverses every intra-module document relationship', () => {
    const source = readMigration('Migration20260713092156_documents.ts')
    const up = upSection(source)
    const down = downSection(source)
    const constraints = [
      'documents_folder_id_foreign',
      'document_folders_parent_folder_id_foreign',
      'document_contents_document_id_foreign',
      'document_comments_document_id_foreign',
      'document_comments_parent_comment_id_foreign',
      'document_attachments_document_id_foreign',
      'document_shares_document_id_foreign',
      'document_versions_document_id_foreign',
      'document_entity_links_document_id_foreign',
    ]

    for (const constraint of constraints) {
      expect(up).toContain(`add constraint "${constraint}" foreign key`)
      expect(down).toContain(`drop constraint if exists "${constraint}"`)
    }
  })

  it('uses idempotent drops for every table and index removal in down()', () => {
    const migrationFiles = readdirSync(migrationsDir)
      .filter((fileName) => fileName.endsWith('.ts'))
      .sort()
    expect(migrationFiles.length).toBeGreaterThanOrEqual(5)

    for (const fileName of migrationFiles) {
      const down = downSection(readMigration(fileName))
      const bareDrops = down.match(/drop (?:table|index) (?!if exists)/g) ?? []
      expect({ fileName, bareDrops }).toEqual({ fileName, bareDrops: [] })
    }
  })
})
