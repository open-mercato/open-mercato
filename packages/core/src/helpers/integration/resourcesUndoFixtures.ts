import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest } from './api'
import { withClient } from './dbFixtures'
import { deleteGeneralEntityIfExists, expectId, readJsonSafe } from './generalFixtures'
import { assertFieldsEqual, expectOperation, redoOk, undoByToken, undoOk } from './undoHarness'

export type ResourceUndoScope = { tenantId: string; organizationId: string }

const resourceUndoTables = [
  'resources_resources',
  'resources_resource_types',
  'resources_resource_activities',
  'resources_resource_comments',
  'resources_resource_tags',
  'resources_resource_tag_assignments',
] as const

export type ResourceUndoTable = (typeof resourceUndoTables)[number]
export type ResourceUndoRow = {
  id: string
  updated_at: Date | string
  deleted_at: string | null
}

export type ResourceUndoLifecycleConfig = {
  collectionPath: string
  commandPrefix: string
  table: ResourceUndoTable
  scope: ResourceUndoScope
  createPayload: Record<string, unknown>
  updatePayload: Record<string, unknown>
  expectedCreate: Record<string, unknown>
  expectedUpdate: Record<string, unknown>
  scalarFields: string[]
  extraQuery?: Record<string, string>
  softDeleteOnCreateUndo?: boolean
}

export function resourceUndoStamp(): string {
  return randomUUID()
}

export async function createResourceUndoFixture(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
): Promise<{ id: string; response: APIResponse }> {
  const response = await apiRequest(request, 'POST', path, { token, data })
  const body = await readJsonSafe<Record<string, unknown>>(response)
  expect(response.status(), `Create ${path}: ${JSON.stringify(body)}`).toBe(201)
  return { id: expectId(body?.id, `${path} fixture id`), response }
}

export async function deleteResourceUndoFixture(
  request: APIRequestContext,
  token: string | null,
  path: string,
  id: string | null,
): Promise<void> {
  await deleteGeneralEntityIfExists(request, token, path, id)
}

export async function readResourceUndoRecord(
  request: APIRequestContext,
  token: string,
  path: string,
  id: string,
  extraQuery: Record<string, string> = {},
): Promise<Record<string, unknown> | null> {
  const query = new URLSearchParams({ ids: id, pageSize: '100', ...extraQuery })
  const response = await apiRequest(request, 'GET', `${path}?${query}`, { token })
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
  expect(response.status(), `Read ${path}: ${JSON.stringify(body)}`).toBe(200)
  expect(Array.isArray(body?.items), `${path} list items`).toBe(true)
  return body?.items?.find((item) => item.id === id) ?? null
}

export async function readResourceUndoRow(
  table: ResourceUndoTable,
  id: string,
  scope: ResourceUndoScope,
): Promise<ResourceUndoRow | null> {
  expect(resourceUndoTables).toContain(table)
  return withClient(async (client) => {
    const result = await client.query<ResourceUndoRow>(
      `select record.id, record.updated_at, to_jsonb(record)->>'deleted_at' as deleted_at
       from ${table} as record where record.id = $1 and record.tenant_id = $2 and record.organization_id = $3`,
      [id, scope.tenantId, scope.organizationId],
    )
    return result.rows[0] ?? null
  })
}

export async function assertResourceRowState(
  table: ResourceUndoTable,
  id: string,
  scope: ResourceUndoScope,
  deleted: boolean,
): Promise<ResourceUndoRow> {
  const row = await readResourceUndoRow(table, id, scope)
  expect(row, `${table} ${id} remains in the database`).not.toBeNull()
  if (deleted) expect(row?.deleted_at, `${table} ${id} is soft-deleted`).toBeTruthy()
  else expect(row?.deleted_at, `${table} ${id} is active`).toBeNull()
  return row as ResourceUndoRow
}

export function assertResourceScalarSnapshot(
  actual: Record<string, unknown> | null,
  expected: Record<string, unknown> | null,
  fields: string[],
  context: string,
): void {
  assertFieldsEqual(actual, expected, fields, context)
}

export async function expectResourceUndoTokenConsumed(
  request: APIRequestContext,
  token: string,
  undoToken: string,
): Promise<void> {
  const response = await undoByToken(request, token, undoToken)
  expect(response.status(), 'I5: consumed undo token returns 400').toBe(400)
  expect(await readJsonSafe(response), 'I5: consumed undo token error').toMatchObject({
    error: 'Undo token not available',
  })
}

export async function runResourceUndoLifecycle(
  request: APIRequestContext,
  token: string,
  operation: 'create' | 'update' | 'delete',
  config: ResourceUndoLifecycleConfig,
): Promise<void> {
  let id: string | null = null
  try {
    const created = await createResourceUndoFixture(request, token, config.collectionPath, config.createPayload)
    id = created.id
    const before = await readResourceUndoRecord(request, token, config.collectionPath, id, config.extraQuery)
    expect(before, 'Created record exposes every initial scalar').toMatchObject(config.expectedCreate)
    const createOperation = expectOperation(created.response, `${config.commandPrefix}.create`)
    expect(createOperation.commandId).toBe(`${config.commandPrefix}.create`)
    expect(createOperation.resourceId).toBe(id)

    if (operation === 'create') {
      await undoOk(request, token, createOperation.undoToken, `${config.commandPrefix} create undo`)
      expect(await readResourceUndoRecord(request, token, config.collectionPath, id, config.extraQuery), 'I3: create undo hides the record').toBeNull()
      if (config.softDeleteOnCreateUndo) await assertResourceRowState(config.table, id, config.scope, true)
      await expectResourceUndoTokenConsumed(request, token, createOperation.undoToken)
      await redoOk(request, token, createOperation.logId, `${config.commandPrefix} create redo`)
      const restored = await readResourceUndoRecord(request, token, config.collectionPath, id, config.extraQuery)
      assertResourceScalarSnapshot(restored, before, ['id', ...config.scalarFields], 'I6: create redo restores the same ID and scalars')
      await assertResourceRowState(config.table, id, config.scope, false)
      return
    }

    const response = operation === 'update'
      ? await apiRequest(request, 'PUT', config.collectionPath, { token, data: { ...config.updatePayload, id } })
      : await apiRequest(request, 'DELETE', `${config.collectionPath}?id=${encodeURIComponent(id)}`, { token })
    expect(response.status(), `${config.commandPrefix}.${operation} status`).toBe(200)
    const mutation = expectOperation(response, `${config.commandPrefix}.${operation}`)
    expect(mutation.commandId).toBe(`${config.commandPrefix}.${operation}`)
    expect(mutation.resourceId).toBe(id)
    const after = await readResourceUndoRecord(request, token, config.collectionPath, id, config.extraQuery)
    if (operation === 'update') expect(after, 'Updated record exposes every changed scalar').toMatchObject(config.expectedUpdate)
    else {
      expect(after, 'Deleted record is absent from its collection').toBeNull()
      if (config.softDeleteOnCreateUndo) await assertResourceRowState(config.table, id, config.scope, true)
    }
    const rowBeforeUndo = operation === 'update' ? await assertResourceRowState(config.table, id, config.scope, false) : null

    await undoOk(request, token, mutation.undoToken, `${config.commandPrefix} ${operation} undo`)
    const restored = await readResourceUndoRecord(request, token, config.collectionPath, id, config.extraQuery)
    assertResourceScalarSnapshot(restored, before, ['id', ...config.scalarFields], `I${operation === 'update' ? '1' : '2'}: undo restores every scalar`)
    const rowAfterUndo = await assertResourceRowState(config.table, id, config.scope, false)
    if (rowBeforeUndo) {
      expect(new Date(rowAfterUndo.updated_at).getTime(), 'Update undo advances updated_at').toBeGreaterThan(new Date(rowBeforeUndo.updated_at).getTime())
    }
    await expectResourceUndoTokenConsumed(request, token, mutation.undoToken)
    await redoOk(request, token, mutation.logId, `${config.commandPrefix} ${operation} redo`)
    const redone = await readResourceUndoRecord(request, token, config.collectionPath, id, config.extraQuery)
    if (operation === 'update') assertResourceScalarSnapshot(redone, after, ['id', ...config.scalarFields], 'I6: redo restores the complete updated snapshot')
    else {
      expect(redone, 'I6: redo deletes the original ID again').toBeNull()
      if (config.softDeleteOnCreateUndo) await assertResourceRowState(config.table, id, config.scope, true)
    }
  } finally {
    await deleteResourceUndoFixture(request, token, config.collectionPath, id)
  }
}
