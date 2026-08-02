import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { features } from '../../template/src/modules/reference_module/acl.js'
import { REFERENCE_TASK_ENTITY_ID } from '../../template/src/modules/reference_module/data/entity-id.js'
import {
  referenceScopeSchema,
  referenceTaskCreateSchema,
  referenceTaskLinkCreateSchema,
} from '../../template/src/modules/reference_module/data/validators.js'
import { defaultEncryptionMaps } from '../../template/src/modules/reference_module/encryption.js'

const CREATE_APP_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const REFERENCE_ROOT = path.join(CREATE_APP_ROOT, 'template/src/modules/reference_module')

function readReferenceFile(relativePath: string): string {
  return fs.readFileSync(path.join(REFERENCE_ROOT, relativePath), 'utf8')
}

test('reference data contract keeps identifiers, validators, ACL, and encryption aligned', () => {
  assert.equal(REFERENCE_TASK_ENTITY_ID, 'reference_module:reference_task')
  assert.deepEqual(features.map((feature) => feature.id), [
    'reference_module.view',
    'reference_module.manage',
    'reference_module.import',
  ])
  assert.deepEqual(features[1]?.dependsOn, ['reference_module.view'])
  assert.deepEqual(features[2]?.dependsOn, ['reference_module.manage'])

  assert.equal(referenceScopeSchema.safeParse({ tenantId: randomUUID() }).success, false)
  assert.equal(referenceTaskCreateSchema.safeParse({ title: '', priority: 6 }).success, false)
  assert.equal(referenceTaskCreateSchema.safeParse({ title: 'Scoped task', priority: 5 }).success, true)
  assert.equal(referenceTaskLinkCreateSchema.safeParse({
    targetKind: 'customer',
    targetId: randomUUID(),
    targetLabelSnapshot: 'client-controlled',
  }).success, false)

  assert.deepEqual(
    defaultEncryptionMaps.map((entry) => [entry.entityId, entry.fields.map((field) => field.field)]),
    [
      ['reference_module:reference_task', ['description']],
      ['reference_module:reference_task_link', ['target_label_snapshot']],
      ['reference_module:reference_task_undo_snapshot', ['payload']],
    ],
  )
})

test('reference entities and setup fail closed on scope without cross-module ORM imports', () => {
  const entities = readReferenceFile('data/entities.ts')
  const setup = readReferenceFile('setup.ts')
  const extensions = readReferenceFile('data/extensions.ts')

  assert.equal((entities.match(/tenantId!:/g) ?? []).length, 3)
  assert.equal((entities.match(/organizationId!:/g) ?? []).length, 3)
  assert.match(entities, /onUpdate: \(\) => new Date\(\)/)
  assert.match(entities, /targetLabelSnapshot/)
  assert.doesNotMatch(entities, /modules\/(?:customers|catalog|sales)/)
  assert.match(extensions, /without cross-module ORM relationships/)
  assert.match(setup, /tenantId: scope\.tenantId/)
  assert.match(setup, /organizationId: scope\.organizationId/)
  assert.match(setup, /defaultRoleFeatures/)
  assert.match(setup, /ensureCustomFieldDefinitions/)
})

test('reference migration and snapshot describe the same scoped tables and safety constraints', () => {
  const migration = readReferenceFile('migrations/Migration20260802000000_reference_module.ts')
  const snapshot = JSON.parse(readReferenceFile('migrations/.snapshot-open-mercato.json')) as {
    tables: Array<{ name: string; columns: Record<string, unknown>; foreignKeys: Record<string, unknown> }>
  }
  const tableNames = snapshot.tables.map((table) => table.name)

  assert.deepEqual(tableNames, [
    'reference_module_tasks',
    'reference_module_task_links',
    'reference_module_task_undo_snapshots',
  ])
  for (const table of snapshot.tables) {
    assert.ok(table.columns.tenant_id)
    assert.ok(table.columns.organization_id)
    assert.ok(migration.includes(`create table \"${table.name}\"`))
  }
  assert.ok(snapshot.tables[1]?.foreignKeys.reference_module_task_links_task_id_foreign)
  assert.ok(snapshot.tables[2]?.foreignKeys.reference_module_task_undo_snapshots_task_id_foreign)
  assert.match(migration, /reference_module_task_links_active_unique/)
  assert.match(migration, /priority.*between 0 and 5/)
})
