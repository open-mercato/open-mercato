import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { z } from 'zod'
import {
  apiRequest,
  getAuthToken,
  withCredentialIsolatedRequest,
} from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  expectOperation,
  redoOk,
  skipIfUndoTestsDisabled,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'
import { buildDealDuplicatePayload } from '../lib/duplicateDeal'

const provenanceListItemSchema = z.object({
  id: z.string().uuid(),
  created_by_user_id: z.string().uuid().nullable().optional(),
}).passthrough()

const provenanceListResponseSchema = z.object({
  items: z.array(provenanceListItemSchema),
}).passthrough()

const provenanceDetailRecordSchema = z.object({
  id: z.string().uuid(),
  createdByUserId: z.string().uuid().nullable(),
  ownerUserId: z.string().uuid().nullable().optional(),
  pipelineId: z.string().uuid().nullable().optional(),
  pipelineStageId: z.string().uuid().nullable().optional(),
  valueAmount: z.preprocess(
    (value) => typeof value === 'string' ? Number(value) : value,
    z.number().finite().nullable().optional(),
  ),
  valueCurrency: z.string().nullable().optional(),
  probability: z.number().nullable().optional(),
  expectedCloseAt: z.string().nullable().optional(),
}).passthrough()

const provenanceDetailResponseSchema = z.object({
  person: provenanceDetailRecordSchema.nullable().optional(),
  company: provenanceDetailRecordSchema.nullable().optional(),
  deal: provenanceDetailRecordSchema.nullable().optional(),
}).passthrough()

const createResponseSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  entityId: z.string().uuid().nullable().optional(),
  personId: z.string().uuid().nullable().optional(),
  companyId: z.string().uuid().nullable().optional(),
  dealId: z.string().uuid().nullable().optional(),
}).passthrough()

const apiKeyCreateResponseSchema = z.object({
  id: z.string().uuid(),
  secret: z.string().min(1),
}).passthrough()

const tenantCreateResponseSchema = z.object({
  id: z.string().uuid(),
}).passthrough()

const actionLogListResponseSchema = z.object({
  items: z.array(z.object({
    id: z.string().uuid(),
    actorUserId: z.string().uuid().nullable(),
  }).passthrough()),
}).passthrough()

type ProvenanceListItem = z.infer<typeof provenanceListItemSchema>
type ProvenanceDetailRecord = z.infer<typeof provenanceDetailRecordSchema>
type DetailKey = 'person' | 'company' | 'deal'
type CreateIdKey = 'personId' | 'companyId' | 'dealId'

type RecordConfig = {
  label: string
  collectionPath: string
  detailKey: DetailKey
  createIdKey: CreateIdKey
  entityType: string
  createPayload: (marker: string) => Record<string, unknown>
}

type SessionAuth = {
  token: string
  headers?: Record<string, string>
}

type ApiKeyAuth = {
  apiKey: string
}

type RequestAuth = SessionAuth | ApiKeyAuth

type CreatedRecord = {
  config: RecordConfig
  id: string
  auth?: RequestAuth
}

const RECORD_CONFIGS: readonly RecordConfig[] = [
  {
    label: 'person',
    collectionPath: '/api/customers/people',
    detailKey: 'person',
    createIdKey: 'personId',
    entityType: 'customers:customer_entity',
    createPayload: (marker) => ({
      firstName: 'Creator',
      lastName: marker,
      displayName: `Creator Person ${marker}`,
    }),
  },
  {
    label: 'company',
    collectionPath: '/api/customers/companies',
    detailKey: 'company',
    createIdKey: 'companyId',
    entityType: 'customers:customer_entity',
    createPayload: (marker) => ({ displayName: `Creator Company ${marker}` }),
  },
  {
    label: 'deal',
    collectionPath: '/api/customers/deals',
    detailKey: 'deal',
    createIdKey: 'dealId',
    entityType: 'customers:customer_deal',
    createPayload: (marker) => ({ title: `Creator Deal ${marker}`, status: 'open' }),
  },
]

async function bufferResponse(response: APIResponse): Promise<APIResponse> {
  const buffered = await response.body()
  return new Proxy(response, {
    get(target, property, receiver) {
      if (property === 'body') return async () => buffered
      if (property === 'text') return async () => buffered.toString('utf8')
      if (property === 'json') return async () => JSON.parse(buffered.toString('utf8'))
      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

async function sendRequest(
  request: APIRequestContext,
  auth: RequestAuth,
  method: string,
  path: string,
  data?: unknown,
): Promise<APIResponse> {
  if ('apiKey' in auth) {
    return withCredentialIsolatedRequest(async (isolatedRequest) => {
      const response = await isolatedRequest.fetch(path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': auth.apiKey,
        },
        data,
      })
      return bufferResponse(response)
    })
  }
  return apiRequest(request, method, path, {
    token: auth.token,
    headers: auth.headers,
    data,
  })
}

async function createRecord(
  request: APIRequestContext,
  auth: RequestAuth,
  config: RecordConfig,
  payload: Record<string, unknown>,
): Promise<{ id: string; response: APIResponse }> {
  const response = await sendRequest(request, auth, 'POST', config.collectionPath, payload)
  expect(response.status(), `${config.label} create should return 201`).toBe(201)
  const body = createResponseSchema.parse(await readJsonSafe<unknown>(response))
  const id = body.id ?? body.entityId ?? body[config.createIdKey]
  return {
    id: expectId(id, `${config.label} create response should include an id`),
    response,
  }
}

async function readListItem(
  request: APIRequestContext,
  auth: RequestAuth,
  config: RecordConfig,
  id: string,
  requireFresh = false,
): Promise<ProvenanceListItem> {
  const query = new URLSearchParams({
    id,
    provenanceCacheBypass: randomUUID(),
  })
  const response = await sendRequest(request, auth, 'GET', `${config.collectionPath}?${query.toString()}`)
  expect(response.status(), `${config.label} list should return 200`).toBe(200)
  if (requireFresh) {
    expect(response.headers()['x-om-cache'], `${config.label} list should not use a cached payload`).not.toBe('hit')
  }
  const body = provenanceListResponseSchema.parse(await readJsonSafe<unknown>(response))
  const item = body.items.find((candidate) => candidate.id === id)
  expect(item, `${config.label} list should contain ${id}`).toBeDefined()
  return item as ProvenanceListItem
}

async function readDetailRecord(
  request: APIRequestContext,
  auth: RequestAuth,
  config: RecordConfig,
  id: string,
): Promise<ProvenanceDetailRecord> {
  const response = await sendRequest(
    request,
    auth,
    'GET',
    `${config.collectionPath}/${encodeURIComponent(id)}`,
  )
  expect(response.status(), `${config.label} detail should return 200`).toBe(200)
  const body = provenanceDetailResponseSchema.parse(await readJsonSafe<unknown>(response))
  const record = body[config.detailKey]
  expect(record, `${config.label} detail should contain ${config.detailKey}`).toBeDefined()
  return record as ProvenanceDetailRecord
}

async function expectCreator(
  request: APIRequestContext,
  auth: RequestAuth,
  config: RecordConfig,
  id: string,
  expectedCreator: string | null,
  requireFresh = false,
): Promise<ProvenanceDetailRecord> {
  const listItem = await readListItem(request, auth, config, id, requireFresh)
  expect(
    Object.prototype.hasOwnProperty.call(listItem, 'created_by_user_id'),
    `${config.label} list item should contain created_by_user_id`,
  ).toBe(true)
  expect(listItem.created_by_user_id, `${config.label} list creator`).toBe(expectedCreator)

  const detailRecord = await readDetailRecord(request, auth, config, id)
  expect(
    Object.prototype.hasOwnProperty.call(detailRecord, 'createdByUserId'),
    `${config.label} detail should contain createdByUserId`,
  ).toBe(true)
  expect(detailRecord.createdByUserId, `${config.label} detail creator`).toBe(expectedCreator)
  return detailRecord
}

async function deleteRecordIfExists(
  request: APIRequestContext,
  auth: RequestAuth,
  config: RecordConfig,
  id: string,
): Promise<void> {
  await sendRequest(
    request,
    auth,
    'DELETE',
    `${config.collectionPath}?id=${encodeURIComponent(id)}`,
  ).catch(() => undefined)
}

async function deleteCreatedRecords(
  request: APIRequestContext,
  fallbackAuth: RequestAuth,
  records: CreatedRecord[],
): Promise<void> {
  for (const record of records.reverse()) {
    await deleteRecordIfExists(request, record.auth ?? fallbackAuth, record.config, record.id)
  }
}

async function deleteApiKeyIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${encodeURIComponent(id)}`, { token })
    .catch(() => undefined)
}

async function createCustomerApiKey(
  request: APIRequestContext,
  token: string,
  input: { name: string; organizationId: string; roleId: string },
): Promise<z.infer<typeof apiKeyCreateResponseSchema>> {
  const response = await apiRequest(request, 'POST', '/api/api_keys/keys', {
    token,
    data: {
      name: input.name,
      organizationId: input.organizationId,
      roles: [input.roleId],
    },
  })
  expect(response.status(), 'API key creation should return 201').toBe(201)
  return apiKeyCreateResponseSchema.parse(await readJsonSafe<unknown>(response))
}

async function createTenantFixture(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', {
    token,
    data: { name },
  })
  expect(response.status(), 'Tenant creation should return 201').toBe(201)
  return tenantCreateResponseSchema.parse(await readJsonSafe<unknown>(response)).id
}

function scopeCookie(tenantId: string, organizationId: string | null): string {
  return [
    `om_selected_tenant=${encodeURIComponent(tenantId)}`,
    `om_selected_org=${encodeURIComponent(organizationId ?? '__all__')}`,
  ].join('; ')
}

async function expectActionActor(
  request: APIRequestContext,
  token: string,
  operationResponse: APIResponse,
  expectedActorId: string,
  context: string,
): Promise<void> {
  const operation = expectOperation(operationResponse, context)
  const response = await apiRequest(
    request,
    'GET',
    `/api/audit_logs/audit-logs/actions?ids=${encodeURIComponent(operation.logId)}&pageSize=1`,
    { token },
  )
  expect(response.status(), `${context} action log should return 200`).toBe(200)
  const body = actionLogListResponseSchema.parse(await readJsonSafe<unknown>(response))
  const action = body.items.find((item) => item.id === operation.logId)
  expect(action, `${context} action log should contain ${operation.logId}`).toBeDefined()
  expect(action?.actorUserId, `${context} action log actor`).toBe(expectedActorId)
}

async function stripCreatorFromIndex(
  config: RecordConfig,
  id: string,
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
  await withClient(async (client) => {
    let indexed = false
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const existing = await client.query<{ entity_id: string }>(
        `select entity_id from entity_indexes
         where entity_type = $1 and entity_id = $2 and tenant_id = $3
           and organization_id = $4 and deleted_at is null
         limit 1`,
        [config.entityType, id, scope.tenantId, scope.organizationId],
      )
      if (existing.rows.length > 0) {
        indexed = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    expect(indexed, `entity_indexes should contain ${id}`).toBe(true)
    const updated = await client.query<{ entity_id: string }>(
      `update entity_indexes set doc = doc - 'created_by_user_id'
       where entity_type = $1 and entity_id = $2 and tenant_id = $3
         and organization_id = $4 and deleted_at is null
       returning entity_id`,
      [config.entityType, id, scope.tenantId, scope.organizationId],
    )
    expect(updated.rows, `exactly one entity_indexes row should be updated for ${id}`).toHaveLength(1)
  })
}

async function expectIndexCreatorAbsent(
  config: RecordConfig,
  id: string,
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
  await withClient(async (client) => {
    const result = await client.query<{ has_key: boolean }>(
      `select doc ? 'created_by_user_id' as has_key from entity_indexes
       where entity_type = $1 and entity_id = $2 and tenant_id = $3
         and organization_id = $4 and deleted_at is null`,
      [config.entityType, id, scope.tenantId, scope.organizationId],
    )
    expect(result.rows, `entity_indexes should contain one row for ${id}`).toHaveLength(1)
    expect(result.rows[0].has_key, `entity_indexes doc should omit created_by_user_id for ${id}`).toBe(false)
  })
}

async function expectScopedRecordHidden(
  request: APIRequestContext,
  auth: RequestAuth,
  config: RecordConfig,
  id: string,
): Promise<void> {
  const detailResponse = await sendRequest(
    request,
    auth,
    'GET',
    `${config.collectionPath}/${encodeURIComponent(id)}`,
  )
  expect(detailResponse.status(), `${config.label} detail should be hidden`).toBe(404)

  const listResponse = await sendRequest(
    request,
    auth,
    'GET',
    `${config.collectionPath}?id=${encodeURIComponent(id)}&provenanceCacheBypass=${randomUUID()}`,
  )
  expect(listResponse.status(), `${config.label} list should remain readable`).toBe(200)
  const listBody = provenanceListResponseSchema.parse(await readJsonSafe<unknown>(listResponse))
  expect(listBody.items.some((item) => item.id === id), `${config.label} list should hide ${id}`).toBe(false)

  const exportResponse = await sendRequest(
    request,
    auth,
    'GET',
    `${config.collectionPath}?id=${encodeURIComponent(id)}&format=csv`,
  )
  expect(exportResponse.status(), `${config.label} export should remain readable`).toBe(200)
  expect(await exportResponse.text(), `${config.label} export should hide ${id}`).not.toContain(id)
}

async function expectScopedExportVisible(
  request: APIRequestContext,
  auth: RequestAuth,
  config: RecordConfig,
  id: string,
): Promise<void> {
  const response = await sendRequest(
    request,
    auth,
    'GET',
    `${config.collectionPath}?id=${encodeURIComponent(id)}&format=csv`,
  )
  expect(response.status(), `${config.label} export should return 200`).toBe(200)
  expect(await response.text(), `${config.label} export should contain ${id}`).toContain(id)
}

test.describe('TC-CRM-7700: CRM record creation provenance API', () => {
  test.describe.configure({ timeout: 300_000 })

  test('pins human, API-key, forged-input, immutable-owner, duplicate and export contracts', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const adminScope = getTokenScope(adminToken)
    const marker = randomUUID()
    const createdRecords: CreatedRecord[] = []
    const humanRecordIds = new Map<DetailKey, string>()
    let roleId: string | null = null
    let userId: string | null = null
    let apiKeyId: string | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, {
        name: `crm-7700-duplicator-${marker}`,
        tenantId: adminScope.tenantId,
      })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: ['customers.*', 'audit_logs.*'],
        organizations: [adminScope.organizationId],
      })
      const userEmail = `crm-7700-duplicator-${marker}@example.test`
      const userPassword = `Qa1!${randomUUID()}`
      userId = await createUserFixture(request, adminToken, {
        email: userEmail,
        password: userPassword,
        organizationId: adminScope.organizationId,
        roles: [roleId],
        name: `CRM 7700 Duplicator ${marker}`,
      })
      const userToken = await getAuthToken(request, userEmail, userPassword)
      const userScope = getTokenScope(userToken)
      expect(userScope.userId).toBe(userId)

      const apiKey = await createCustomerApiKey(request, adminToken, {
        name: `crm-7700-${marker}`,
        organizationId: adminScope.organizationId,
        roleId,
      })
      apiKeyId = apiKey.id
      const apiKeyAuth: ApiKeyAuth = { apiKey: apiKey.secret }

      for (const config of RECORD_CONFIGS) {
        const humanCreate = await createRecord(request, { token: adminToken }, config, {
          ...config.createPayload(`${marker}-human-${config.label}`),
          createdByUserId: randomUUID(),
          created_by_user_id: randomUUID(),
        })
        createdRecords.push({ config, id: humanCreate.id })
        humanRecordIds.set(config.detailKey, humanCreate.id)
        await expectActionActor(
          request,
          adminToken,
          humanCreate.response,
          adminScope.userId,
          `${config.label} human create`,
        )
        const humanDetail = await expectCreator(
          request,
          { token: adminToken },
          config,
          humanCreate.id,
          adminScope.userId,
        )

        const echoedDetail = Object.fromEntries(
          Object.entries(humanDetail).filter(([, value]) => value !== null),
        )
        const updateResponse = await sendRequest(request, { token: adminToken }, 'PUT', config.collectionPath, {
          ...echoedDetail,
          id: humanCreate.id,
          ownerUserId: userId,
          createdByUserId: randomUUID(),
          created_by_user_id: randomUUID(),
        })
        expect(updateResponse.status(), `${config.label} GET-to-PUT round trip should succeed`).toBe(200)
        const updatedDetail = await expectCreator(
          request,
          { token: adminToken },
          config,
          humanCreate.id,
          adminScope.userId,
        )
        expect(updatedDetail.ownerUserId, `${config.label} owner should be reassigned`).toBe(userId)

        const keyCreate = await createRecord(
          request,
          apiKeyAuth,
          config,
          config.createPayload(`${marker}-key-${config.label}`),
        )
        createdRecords.push({ config, id: keyCreate.id })
        await expectActionActor(
          request,
          adminToken,
          keyCreate.response,
          apiKey.id,
          `${config.label} API-key create`,
        )
        await expectCreator(request, apiKeyAuth, config, keyCreate.id, null)

        const exportResponse = await sendRequest(
          request,
          { token: adminToken },
          'GET',
          `${config.collectionPath}?id=${encodeURIComponent(humanCreate.id)}&format=csv`,
        )
        expect(exportResponse.status(), `${config.label} CSV export should return 200`).toBe(200)
        expect(exportResponse.headers()['content-type'] ?? '', `${config.label} export content type`).toContain('text/csv')
        const csvHeader = (await exportResponse.text()).split(/\r?\n/, 1)[0] ?? ''
        const normalizedCsvHeader = csvHeader.toLowerCase().replace(/[^a-z0-9]+/g, '_')
        expect(normalizedCsvHeader, `${config.label} CSV header`).toContain('created_by_user_id')
      }

      const dealConfig = RECORD_CONFIGS.find((config) => config.detailKey === 'deal')
      const dealId = humanRecordIds.get('deal')
      expect(dealConfig).toBeDefined()
      expect(dealId).toBeDefined()
      const sourceDeal = await readDetailRecord(
        request,
        { token: adminToken },
        dealConfig as RecordConfig,
        dealId as string,
      )
      const duplicate = await createRecord(
        request,
        { token: userToken },
        dealConfig as RecordConfig,
        buildDealDuplicatePayload(sourceDeal, `Duplicated Deal ${marker}`),
      )
      createdRecords.push({ config: dealConfig as RecordConfig, id: duplicate.id })
      await expectCreator(
        request,
        { token: userToken },
        dealConfig as RecordConfig,
        duplicate.id,
        userScope.userId,
      )
    } finally {
      await deleteCreatedRecords(request, { token: adminToken }, createdRecords)
      await deleteApiKeyIfExists(request, adminToken, apiKeyId)
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('preserves creators through delete undo and create undo-redo across actors', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const adminToken = await getAuthToken(request, 'admin')
    const adminScope = getTokenScope(adminToken)
    const marker = randomUUID()
    const createdRecords: CreatedRecord[] = []
    let roleId: string | null = null
    let userId: string | null = null
    let apiKeyId: string | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, {
        name: `crm-7700-undo-${marker}`,
        tenantId: adminScope.tenantId,
      })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: ['customers.*', 'audit_logs.*'],
        organizations: [adminScope.organizationId],
      })
      const userEmail = `crm-7700-undo-${marker}@example.test`
      const userPassword = `Qa1!${randomUUID()}`
      userId = await createUserFixture(request, adminToken, {
        email: userEmail,
        password: userPassword,
        organizationId: adminScope.organizationId,
        roles: [roleId],
      })
      const userToken = await getAuthToken(request, userEmail, userPassword)
      const apiKey = await createCustomerApiKey(request, adminToken, {
        name: `crm-7700-undo-key-${marker}`,
        organizationId: adminScope.organizationId,
        roleId,
      })
      apiKeyId = apiKey.id
      const apiKeyAuth: ApiKeyAuth = { apiKey: apiKey.secret }

      for (const config of RECORD_CONFIGS) {
        const deletedCreate = await createRecord(
          request,
          { token: adminToken },
          config,
          config.createPayload(`${marker}-delete-${config.label}`),
        )
        createdRecords.push({ config, id: deletedCreate.id })
        const deleteResponse = await sendRequest(
          request,
          { token: userToken },
          'DELETE',
          `${config.collectionPath}?id=${encodeURIComponent(deletedCreate.id)}`,
        )
        expect(deleteResponse.ok(), `${config.label} delete by user B should succeed`).toBe(true)
        const deleteOperation = expectOperation(deleteResponse, `${config.label}.delete`)
        await undoOk(request, userToken, deleteOperation.undoToken, `${config.label} delete undo by user B`)
        await expectCreator(
          request,
          { token: userToken },
          config,
          deletedCreate.id,
          adminScope.userId,
        )

        const redoneCreate = await createRecord(
          request,
          { token: adminToken },
          config,
          config.createPayload(`${marker}-redo-${config.label}`),
        )
        createdRecords.push({ config, id: redoneCreate.id })
        const createOperation = expectOperation(redoneCreate.response, `${config.label}.create`)
        await undoOk(request, adminToken, createOperation.undoToken, `${config.label} create undo`)
        await redoOk(request, adminToken, createOperation.logId, `${config.label} create redo`)
        await expectCreator(
          request,
          { token: adminToken },
          config,
          redoneCreate.id,
          adminScope.userId,
        )

        const keyCreate = await createRecord(
          request,
          apiKeyAuth,
          config,
          config.createPayload(`${marker}-key-redo-${config.label}`),
        )
        createdRecords.push({ config, id: keyCreate.id })
        const keyOperation = expectOperation(keyCreate.response, `${config.label}.create via API key`)
        await undoOk(request, adminToken, keyOperation.undoToken, `${config.label} API-key create undo by admin`)
        await redoOk(request, adminToken, keyOperation.logId, `${config.label} API-key create redo by admin`)
        await expectCreator(request, { token: adminToken }, config, keyCreate.id, null)
      }
    } finally {
      await deleteCreatedRecords(request, { token: adminToken }, createdRecords)
      await deleteApiKeyIfExists(request, adminToken, apiKeyId)
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('reads creator provenance from base columns when pre-migration index documents omit it', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const adminScope = getTokenScope(adminToken)
    const marker = randomUUID()
    const createdRecords: CreatedRecord[] = []
    let roleId: string | null = null
    let apiKeyId: string | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, {
        name: `crm-7700-index-${marker}`,
        tenantId: adminScope.tenantId,
      })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: ['customers.*'],
        organizations: [adminScope.organizationId],
      })
      const apiKey = await createCustomerApiKey(request, adminToken, {
        name: `crm-7700-index-${marker}`,
        organizationId: adminScope.organizationId,
        roleId,
      })
      apiKeyId = apiKey.id
      const apiKeyAuth: ApiKeyAuth = { apiKey: apiKey.secret }

      for (const config of RECORD_CONFIGS) {
        const keyCreate = await createRecord(
          request,
          apiKeyAuth,
          config,
          config.createPayload(`${marker}-index-key-${config.label}`),
        )
        createdRecords.push({ config, id: keyCreate.id })
        await stripCreatorFromIndex(config, keyCreate.id, adminScope)
        await expectCreator(request, apiKeyAuth, config, keyCreate.id, null, true)
        await expectIndexCreatorAbsent(config, keyCreate.id, adminScope)

        const humanCreate = await createRecord(
          request,
          { token: adminToken },
          config,
          config.createPayload(`${marker}-index-human-${config.label}`),
        )
        createdRecords.push({ config, id: humanCreate.id })
        await stripCreatorFromIndex(config, humanCreate.id, adminScope)
        await expectCreator(
          request,
          { token: adminToken },
          config,
          humanCreate.id,
          adminScope.userId,
          true,
        )
        await expectIndexCreatorAbsent(config, humanCreate.id, adminScope)
      }
    } finally {
      await deleteCreatedRecords(request, { token: adminToken }, createdRecords)
      await deleteApiKeyIfExists(request, adminToken, apiKeyId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('enforces same-tenant organization scope and cross-tenant isolation', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const adminScope = getTokenScope(adminToken)
    const marker = randomUUID()
    const createdRecords: CreatedRecord[] = []
    let otherOrganizationId: string | null = null
    let otherOrganizationRoleId: string | null = null
    let otherOrganizationUserId: string | null = null
    let visibleRoleId: string | null = null
    let visibleUserId: string | null = null
    let foreignTenantId: string | null = null
    let foreignOrganizationId: string | null = null
    let foreignRoleId: string | null = null
    let foreignUserId: string | null = null

    try {
      otherOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `CRM 7700 Other Org ${marker}`,
        tenantId: adminScope.tenantId,
      })
      otherOrganizationRoleId = await createRoleFixture(request, superadminToken, {
        name: `crm-7700-other-org-${marker}`,
        tenantId: adminScope.tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: otherOrganizationRoleId,
        features: ['customers.people.view', 'customers.companies.view', 'customers.deals.view'],
        organizations: [otherOrganizationId],
      })
      const otherOrganizationEmail = `crm-7700-other-org-${marker}@example.test`
      const otherOrganizationPassword = `Qa1!${randomUUID()}`
      otherOrganizationUserId = await createUserFixture(request, superadminToken, {
        email: otherOrganizationEmail,
        password: otherOrganizationPassword,
        organizationId: otherOrganizationId,
        roles: [otherOrganizationRoleId],
      })
      const otherOrganizationToken = await getAuthToken(
        request,
        otherOrganizationEmail,
        otherOrganizationPassword,
      )

      visibleRoleId = await createRoleFixture(request, superadminToken, {
        name: `crm-7700-visible-${marker}`,
        tenantId: adminScope.tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: visibleRoleId,
        features: ['customers.people.view', 'customers.companies.view', 'customers.deals.view'],
        organizations: [adminScope.organizationId],
      })
      const visibleEmail = `crm-7700-visible-${marker}@example.test`
      const visiblePassword = `Qa1!${randomUUID()}`
      visibleUserId = await createUserFixture(request, superadminToken, {
        email: visibleEmail,
        password: visiblePassword,
        organizationId: adminScope.organizationId,
        roles: [visibleRoleId],
      })
      const visibleToken = await getAuthToken(request, visibleEmail, visiblePassword)

      foreignTenantId = await createTenantFixture(request, superadminToken, `CRM 7700 Tenant ${marker}`)
      foreignOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `CRM 7700 Foreign Org ${marker}`,
        tenantId: foreignTenantId,
      })
      foreignRoleId = await createRoleFixture(request, superadminToken, {
        name: `crm-7700-foreign-${marker}`,
        tenantId: foreignTenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: foreignRoleId,
        features: ['customers.people.view', 'customers.companies.view', 'customers.deals.view'],
        organizations: [foreignOrganizationId],
      })
      const foreignEmail = `crm-7700-foreign-${marker}@example.test`
      const foreignPassword = `Qa1!${randomUUID()}`
      foreignUserId = await createUserFixture(request, superadminToken, {
        email: foreignEmail,
        password: foreignPassword,
        organizationId: foreignOrganizationId,
        roles: [foreignRoleId],
      })
      const foreignToken = await getAuthToken(request, foreignEmail, foreignPassword)

      const otherOrganizationAuth: SessionAuth = {
        token: otherOrganizationToken,
        headers: { Cookie: scopeCookie(adminScope.tenantId, otherOrganizationId) },
      }
      const visibleAuth: SessionAuth = {
        token: visibleToken,
        headers: { Cookie: scopeCookie(adminScope.tenantId, adminScope.organizationId) },
      }
      const foreignAuth: SessionAuth = {
        token: foreignToken,
        headers: { Cookie: scopeCookie(foreignTenantId, foreignOrganizationId) },
      }

      for (const config of RECORD_CONFIGS) {
        const created = await createRecord(
          request,
          { token: adminToken },
          config,
          config.createPayload(`${marker}-scope-${config.label}`),
        )
        createdRecords.push({ config, id: created.id })
        await expectScopedRecordHidden(request, otherOrganizationAuth, config, created.id)
        await expectScopedRecordHidden(request, foreignAuth, config, created.id)
        await expectCreator(request, visibleAuth, config, created.id, adminScope.userId)
        await expectScopedExportVisible(request, visibleAuth, config, created.id)
      }
    } finally {
      await deleteCreatedRecords(request, { token: adminToken }, createdRecords)
      await deleteUserIfExists(request, superadminToken, foreignUserId)
      await deleteRoleIfExists(request, superadminToken, foreignRoleId)
      await deleteOrganizationIfExists(request, superadminToken, foreignOrganizationId)
      await deleteGeneralEntityIfExists(
        request,
        superadminToken,
        '/api/directory/tenants',
        foreignTenantId,
      )
      await deleteUserIfExists(request, superadminToken, visibleUserId)
      await deleteRoleIfExists(request, superadminToken, visibleRoleId)
      await deleteUserIfExists(request, superadminToken, otherOrganizationUserId)
      await deleteRoleIfExists(request, superadminToken, otherOrganizationRoleId)
      await deleteOrganizationIfExists(request, superadminToken, otherOrganizationId)
    }
  })

  test('stores null when a superadmin creates records after switching to another tenant', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const superadminScope = getTokenScope(superadminToken)
    const marker = randomUUID()
    const createdRecords: CreatedRecord[] = []
    let foreignTenantId: string | null = null
    let foreignOrganizationId: string | null = null

    try {
      foreignTenantId = await createTenantFixture(request, superadminToken, `CRM 7700 Switch ${marker}`)
      expect(foreignTenantId).not.toBe(superadminScope.tenantId)
      foreignOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `CRM 7700 Switched Org ${marker}`,
        tenantId: foreignTenantId,
      })
      const switchedAuth: SessionAuth = {
        token: superadminToken,
        headers: { Cookie: scopeCookie(foreignTenantId, foreignOrganizationId) },
      }

      for (const config of RECORD_CONFIGS) {
        const created = await createRecord(
          request,
          switchedAuth,
          config,
          config.createPayload(`${marker}-switched-${config.label}`),
        )
        createdRecords.push({ config, id: created.id, auth: switchedAuth })
        await expectCreator(request, switchedAuth, config, created.id, null)
      }
    } finally {
      await deleteCreatedRecords(request, { token: superadminToken }, createdRecords)
      await deleteOrganizationIfExists(request, superadminToken, foreignOrganizationId)
      await deleteGeneralEntityIfExists(
        request,
        superadminToken,
        '/api/directory/tenants',
        foreignTenantId,
      )
    }
  })
})
