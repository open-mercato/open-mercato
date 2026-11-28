/** @jest-environment node */

import { z, type ZodObject, type ZodRawShape, type ZodTypeAny } from 'zod'
import type { OpenApiHttpMethod, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

type ListPayload = {
  items: unknown[]
  total?: number
}

type ListHookContext = {
  auth: { tenantId: string; orgId: string }
  selectedOrganizationId: string
  container: { resolve: (token: string) => unknown }
}

type CapturedCrudOptions = {
  actions?: {
    create?: { commandId?: string }
  }
  list?: {
    fields?: readonly string[]
  }
  hooks?: {
    afterList?: (payload: ListPayload, context: ListHookContext) => Promise<void> | void
  }
}

const mockCrudOptionsByCommandId = new Map<string, CapturedCrudOptions>()
const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn((options: CapturedCrudOptions) => {
    const commandId = options.actions?.create?.commandId
    if (commandId) mockCrudOptionsByCommandId.set(commandId, options)
    return {
      GET: jest.fn(),
      POST: jest.fn(),
      PUT: jest.fn(),
      DELETE: jest.fn(),
    }
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    customers: {
      customer_entity: 'customers:customer_entity',
      customer_company_profile: 'customers:customer_company_profile',
      customer_person_profile: 'customers:customer_person_profile',
      customer_deal: 'customers:customer_deal',
    },
  },
}), { virtual: true })

import { openApi as peopleListOpenApi } from '../people/route'
import { openApi as companiesListOpenApi } from '../companies/route'
import { openApi as dealsListOpenApi } from '../deals/route'
import { openApi as personDetailOpenApi } from '../people/[id]/route'
import { openApi as companyDetailOpenApi } from '../companies/[id]/route'
import { openApi as dealDetailOpenApi } from '../deals/[id]/route'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const CREATOR_ID = '33333333-3333-4333-8333-333333333333'
const PERSON_ID = '44444444-4444-4444-8444-444444444444'
const SECOND_PERSON_ID = '55555555-5555-4555-8555-555555555555'
const COMPANY_ID = '66666666-6666-4666-8666-666666666666'
const SECOND_COMPANY_ID = '77777777-7777-4777-8777-777777777777'
const DEAL_ID = '88888888-8888-4888-8888-888888888888'
const SECOND_DEAL_ID = '99999999-9999-4999-8999-999999999999'
const CREATOR_DESCRIPTION = 'Read-only server-assigned creator attribution.'

const listHookContext: ListHookContext = {
  auth: { tenantId: TENANT_ID, orgId: ORGANIZATION_ID },
  selectedOrganizationId: ORGANIZATION_ID,
  container: { resolve: () => ({}) },
}

function requireObjectSchema(schema: ZodTypeAny | undefined, label: string): ZodObject<ZodRawShape> {
  if (!(schema instanceof z.ZodObject)) {
    throw new Error(`[internal] ${label} object schema is missing`)
  }
  return schema
}

function responseSchema(openApi: OpenApiRouteDoc, method: OpenApiHttpMethod): ZodObject<ZodRawShape> {
  const schema = openApi.methods[method]?.responses?.find((response) => response.status === 200)?.schema
  return requireObjectSchema(schema, `${method} response`)
}

function listItemSchema(openApi: OpenApiRouteDoc): ZodObject<ZodRawShape> {
  const itemsSchema = responseSchema(openApi, 'GET').shape.items
  if (!(itemsSchema instanceof z.ZodArray)) {
    throw new Error('[internal] list response items schema is missing')
  }
  return requireObjectSchema(itemsSchema.element, 'list item')
}

function detailRecordSchema(openApi: OpenApiRouteDoc, key: 'person' | 'company' | 'deal'): ZodObject<ZodRawShape> {
  return requireObjectSchema(responseSchema(openApi, 'GET').shape[key], `${key} detail record`)
}

function requestSchema(openApi: OpenApiRouteDoc, method: 'POST' | 'PUT'): ZodObject<ZodRawShape> {
  return requireObjectSchema(openApi.methods[method]?.requestBody?.schema, `${method} request`)
}

function requireCreatorSchema(schema: ZodObject<ZodRawShape>, key: string): ZodTypeAny {
  const creatorSchema = schema.shape[key]
  if (!creatorSchema) throw new Error(`[internal] ${key} schema is missing`)
  return creatorSchema
}

function crudOptions(commandId: string): CapturedCrudOptions {
  const options = mockCrudOptionsByCommandId.get(commandId)
  if (!options) throw new Error(`[internal] CRUD options are missing for ${commandId}`)
  return options
}

async function runAfterList(commandId: string, payload: ListPayload): Promise<void> {
  const afterList = crudOptions(commandId).hooks?.afterList
  if (!afterList) throw new Error(`[internal] afterList hook is missing for ${commandId}`)
  await afterList(payload, listHookContext)
}

function expectCreatorKeysStripped(schema: ZodObject<ZodRawShape>, payload: Record<string, unknown>): void {
  expect(Object.keys(schema.shape)).not.toContain('createdByUserId')
  expect(Object.keys(schema.shape)).not.toContain('created_by_user_id')

  const result = schema.safeParse({
    ...payload,
    createdByUserId: CREATOR_ID,
    created_by_user_id: CREATOR_ID,
  })

  expect(result.success).toBe(true)
  if (!result.success) throw new Error('[internal] creator round-trip payload did not parse')
  expect(result.data).not.toHaveProperty('createdByUserId')
  expect(result.data).not.toHaveProperty('created_by_user_id')
}

describe.each([
  ['people', peopleListOpenApi, { id: PERSON_ID }],
  ['companies', companiesListOpenApi, { id: COMPANY_ID }],
  ['deals', dealsListOpenApi, { id: DEAL_ID, title: null }],
] as const)('%s creator provenance list OpenAPI', (_name, openApi, baseItem) => {
  it('accepts a UUID, null, or an omitted creator id', () => {
    const schema = listItemSchema(openApi)
    const creatorSchema = requireCreatorSchema(schema, 'created_by_user_id')

    expect(creatorSchema.safeParse(CREATOR_ID).success).toBe(true)
    expect(creatorSchema.safeParse(null).success).toBe(true)
    expect(creatorSchema.safeParse(undefined).success).toBe(true)
    expect(creatorSchema.safeParse('not-a-uuid').success).toBe(false)
    expect(creatorSchema.description).toBe(CREATOR_DESCRIPTION)
    expect(schema.safeParse({ ...baseItem, created_by_user_id: CREATOR_ID }).success).toBe(true)
    expect(schema.safeParse({ ...baseItem, created_by_user_id: null }).success).toBe(true)
  })
})

describe.each([
  ['person', personDetailOpenApi, 'person'],
  ['company', companyDetailOpenApi, 'company'],
  ['deal', dealDetailOpenApi, 'deal'],
] as const)('%s creator provenance detail OpenAPI', (_name, openApi, recordKey) => {
  it('requires a UUID or null creator id', () => {
    const schema = requireCreatorSchema(detailRecordSchema(openApi, recordKey), 'createdByUserId')

    expect(schema.safeParse(CREATOR_ID).success).toBe(true)
    expect(schema.safeParse(null).success).toBe(true)
    expect(schema.safeParse(undefined).success).toBe(false)
    expect(schema.safeParse('not-a-uuid').success).toBe(false)
    expect(schema.description).toBe(CREATOR_DESCRIPTION)
  })
})

describe.each([
  [
    'people',
    peopleListOpenApi,
    { organizationId: ORGANIZATION_ID, tenantId: TENANT_ID, firstName: 'Ada', lastName: 'Lovelace' },
    { id: PERSON_ID },
  ],
  [
    'companies',
    companiesListOpenApi,
    { organizationId: ORGANIZATION_ID, tenantId: TENANT_ID, displayName: 'Acme' },
    { id: COMPANY_ID },
  ],
  [
    'deals',
    dealsListOpenApi,
    { organizationId: ORGANIZATION_ID, tenantId: TENANT_ID, title: 'Expansion' },
    { id: DEAL_ID },
  ],
] as const)('%s creator provenance request schemas', (_name, openApi, createPayload, updatePayload) => {
  it('strips creator ids from create requests', () => {
    expectCreatorKeysStripped(requestSchema(openApi, 'POST'), createPayload)
  })

  it('strips creator ids from update requests', () => {
    expectCreatorKeysStripped(requestSchema(openApi, 'PUT'), updatePayload)
  })
})

describe('creator provenance list shaping', () => {
  beforeEach(() => {
    mockFindWithDecryption.mockReset()
  })

  it.each([
    ['customers.people.create', 'people'],
    ['customers.companies.create', 'companies'],
    ['customers.deals.create', 'deals'],
  ] as const)('selects created_by_user_id for %s', (commandId) => {
    expect(crudOptions(commandId).list?.fields).toContain('created_by_user_id')
  })

  it('normalizes people creator ids and prefers the decrypted entity value', async () => {
    mockFindWithDecryption
      .mockResolvedValueOnce([
        { id: PERSON_ID, createdByUserId: null },
        { id: SECOND_PERSON_ID, createdByUserId: CREATOR_ID },
      ])
      .mockResolvedValueOnce([])
    const payload: ListPayload = {
      items: [
        { id: PERSON_ID },
        { id: SECOND_PERSON_ID, created_by_user_id: null },
      ],
    }

    await runAfterList('customers.people.create', payload)

    expect(payload.items[0]).toMatchObject({ created_by_user_id: null })
    expect(payload.items[1]).toMatchObject({ created_by_user_id: CREATOR_ID })
  })

  it('normalizes company creator ids while decorating profiles', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([
      { entity: { id: COMPANY_ID } },
      { entity: { id: SECOND_COMPANY_ID } },
    ])
    const payload: ListPayload = {
      items: [
        { id: COMPANY_ID },
        { id: SECOND_COMPANY_ID, created_by_user_id: CREATOR_ID },
      ],
    }

    await runAfterList('customers.companies.create', payload)

    expect(payload.items[0]).toMatchObject({ created_by_user_id: null })
    expect(payload.items[1]).toMatchObject({ created_by_user_id: CREATOR_ID })
  })

  it('normalizes deal creator ids while decorating associations', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    const payload: ListPayload = {
      items: [
        { id: DEAL_ID },
        { id: SECOND_DEAL_ID, created_by_user_id: CREATOR_ID },
      ],
    }

    await runAfterList('customers.deals.create', payload)

    expect(payload.items[0]).toMatchObject({ created_by_user_id: null })
    expect(payload.items[1]).toMatchObject({ created_by_user_id: CREATOR_ID })
  })

  it('normalizes deal creator ids when association decoration degrades', async () => {
    mockFindWithDecryption.mockRejectedValueOnce(new Error('association lookup failed'))
    const payload: ListPayload = { items: [{ id: DEAL_ID }] }

    await runAfterList('customers.deals.create', payload)

    expect(payload.items[0]).toMatchObject({
      created_by_user_id: null,
      _associations: { ok: false },
    })
  })
})
