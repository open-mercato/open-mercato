/** @jest-environment node */

// Regression for https://github.com/open-mercato/open-mercato/issues/6273 — the
// OpenAPI request body used to be a schema built once at module load, while the
// handler validated against the env-driven schema, so after an env change the
// documented and the enforced ceilings disagreed.

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const channelId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const findOneWithDecryptionMock = jest.fn()
const getAuthFromRequestMock = jest.fn()

const em = { fork: () => em }

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequestMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

import type { ZodTypeAny } from 'zod'
import {
  IMPORT_HISTORY_MAX_MESSAGES_ENV as MAX_MESSAGES_ENV,
  IMPORT_HISTORY_MAX_SINCE_DAYS_ENV as MAX_SINCE_DAYS_ENV,
  IMPORT_HISTORY_MAX_SINCE_DAYS_FALLBACK,
} from '../../../../../../lib/import-history-limits'
import { POST, openApi } from '../route'

function documentedSchema(): ZodTypeAny {
  return openApi.methods.POST.requestBody.schema as ZodTypeAny
}

function postImport(body: Record<string, unknown>) {
  const request = new Request(`http://localhost/api/communication_channels/channels/${channelId}/import-history`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(request, { params: { id: channelId } })
}

describe('POST /communication_channels/channels/[id]/import-history — documented schema', () => {
  const originalSinceDays = process.env[MAX_SINCE_DAYS_ENV]
  const originalMaxMessages = process.env[MAX_MESSAGES_ENV]

  beforeEach(() => {
    jest.clearAllMocks()
    getAuthFromRequestMock.mockResolvedValue({ sub: userId, tenantId, orgId: organizationId })
    findOneWithDecryptionMock.mockResolvedValue(null)
  })

  afterEach(() => {
    if (originalSinceDays === undefined) delete process.env[MAX_SINCE_DAYS_ENV]
    else process.env[MAX_SINCE_DAYS_ENV] = originalSinceDays
    if (originalMaxMessages === undefined) delete process.env[MAX_MESSAGES_ENV]
    else process.env[MAX_MESSAGES_ENV] = originalMaxMessages
  })

  it('documents a body without channelId, which comes from the path', () => {
    const shape = (documentedSchema() as unknown as { shape: Record<string, unknown> }).shape
    expect(Object.keys(shape).sort()).toEqual(['contactEmails', 'maxMessages', 'sinceDays'])
  })

  it('agrees with the enforced schema after the ceilings change at runtime', async () => {
    process.env[MAX_SINCE_DAYS_ENV] = '7300'
    process.env[MAX_MESSAGES_ENV] = '120000'

    const atCeiling = { sinceDays: 7300, maxMessages: 120000 }
    const aboveCeiling = { sinceDays: 7301 }

    expect(documentedSchema().safeParse(atCeiling).success).toBe(true)
    expect(documentedSchema().safeParse(aboveCeiling).success).toBe(false)

    const accepted = await postImport(atCeiling)
    expect(accepted.status).toBe(404)
    expect(findOneWithDecryptionMock).toHaveBeenCalledTimes(1)

    const rejected = await postImport(aboveCeiling)
    expect(rejected.status).toBe(400)
    expect(findOneWithDecryptionMock).toHaveBeenCalledTimes(1)
  })

  it('agrees with the enforced schema at the shipped ceilings', async () => {
    delete process.env[MAX_SINCE_DAYS_ENV]
    delete process.env[MAX_MESSAGES_ENV]

    const ceiling = IMPORT_HISTORY_MAX_SINCE_DAYS_FALLBACK
    expect(documentedSchema().safeParse({ sinceDays: ceiling }).success).toBe(true)
    expect(documentedSchema().safeParse({ sinceDays: ceiling + 1 }).success).toBe(false)
    expect((await postImport({ sinceDays: ceiling + 1 })).status).toBe(400)
  })
})
