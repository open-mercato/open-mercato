/** @jest-environment node */

const sendAsUserMock = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    sub: '33333333-3333-4333-8333-333333333333',
    tenantId: '11111111-1111-4111-8111-111111111111',
    orgId: '22222222-2222-4222-8222-222222222222',
  })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({ resolve: () => null })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (key: string) => `translated:${key}` }),
}))

jest.mock('../../../../lib/route-mutation-guard', () => ({
  validateRouteMutationGuard: jest.fn(async () => ({ afterSuccess: jest.fn(async () => undefined) })),
}))

jest.mock('../../../../lib/send-as-user', () => ({
  ...jest.requireActual('../../../../lib/send-as-user'),
  sendAsUser: (...args: unknown[]) => sendAsUserMock(...args),
}))

import { buildOpenApiDocument } from '@open-mercato/shared/lib/openapi/generator'
import type { Module, ModuleApiRouteFile } from '@open-mercato/shared/modules/registry'
import { POST, openApi } from '../route'

function post(body: Record<string, unknown>) {
  return POST(new Request('http://localhost/api/communication_channels/send-as-user', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      userChannelId: '44444444-4444-4444-8444-444444444444',
      subject: 'Hello',
      body: { plain: 'Hi' },
      ...body,
    }),
  }))
}

describe('POST /communication_channels/send-as-user — sendSeparately', () => {
  beforeEach(() => {
    sendAsUserMock.mockReset()
    sendAsUserMock.mockResolvedValue({ ok: true, messageId: 'm-1', threadId: 't-1', channelId: 'c-1', providerKey: 'imap' })
  })

  it('rejects separate sending to several recipients with cc and bcc as 400 with field errors', async () => {
    const response = await post({
      to: ['a@example.com', 'b@example.com'],
      cc: ['c@example.com'],
      bcc: ['d@example.com'],
      sendSeparately: true,
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'translated:messages.errors.sendSeparatelyWithCopies',
      fieldErrors: {
        cc: 'translated:messages.errors.sendSeparatelyWithCopies',
        bcc: 'translated:messages.errors.sendSeparatelyWithCopies',
      },
    })
    expect(sendAsUserMock).not.toHaveBeenCalled()
  })

  it('accepts separate sending to several recipients without copies', async () => {
    const response = await post({ to: ['a@example.com', 'b@example.com'], sendSeparately: true })

    expect(response.status).toBe(202)
    expect(sendAsUserMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ to: ['a@example.com', 'b@example.com'], sendSeparately: true }),
    )
  })

  it('accepts cc with separate sending to a single recipient', async () => {
    const response = await post({ to: ['a@example.com'], cc: ['c@example.com'], sendSeparately: true })

    expect(response.status).toBe(202)
  })

  it('keeps 422 for other invalid bodies', async () => {
    const response = await post({ to: [] })

    expect(response.status).toBe(422)
  })
})

describe('POST /communication_channels/send-as-user — existing message', () => {
  beforeEach(() => {
    sendAsUserMock.mockReset()
  })

  function postExisting(body: Record<string, unknown>) {
    return POST(new Request('http://localhost/api/communication_channels/send-as-user', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userChannelId: '44444444-4444-4444-8444-444444444444', ...body }),
    }))
  }

  it('accepts messageId without recipients, subject or body', async () => {
    sendAsUserMock.mockResolvedValue({ ok: true, messageId: '55555555-5555-4555-8555-555555555555', threadId: 't-1', channelId: 'c-1', providerKey: 'imap' })

    const response = await postExisting({ messageId: '55555555-5555-4555-8555-555555555555' })

    expect(response.status).toBe(202)
    expect(sendAsUserMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { userChannelId: '44444444-4444-4444-8444-444444444444', messageId: '55555555-5555-4555-8555-555555555555' },
    )
  })

  it('answers 409 when the message is already linked', async () => {
    sendAsUserMock.mockResolvedValue({ ok: false, status: 409, error: 'Message is already linked to a channel delivery', code: 'already_linked' })

    const response = await postExisting({ messageId: '55555555-5555-4555-8555-555555555555' })

    expect(response.status).toBe(409)
  })
})

describe('POST /api/communication_channels/send-as-user — published request contract', () => {
  function requestBodyBranches(): Array<Record<string, unknown>> {
    const routePath = '/communication_channels/send-as-user'
    const api: ModuleApiRouteFile = {
      path: routePath,
      metadata: { POST: { requireAuth: true } },
      handlers: { POST: async () => new Response(null) },
      docs: openApi,
    }
    const doc = buildOpenApiDocument([{ id: 'communication_channels', apis: [api] } as Module])
    const schemas = ((doc.components ?? {}) as { schemas?: Record<string, Record<string, unknown>> }).schemas ?? {}
    const resolve = (schema: Record<string, unknown>) => (typeof schema.$ref === 'string' ? schemas[schema.$ref.split('/').pop() as string] : schema)
    const operation = doc.paths[routePath].post as { requestBody: { content: Record<string, { schema: Record<string, unknown> }> } }
    const body = resolve(operation.requestBody.content['application/json'].schema)
    const branches = (body.anyOf ?? body.oneOf) as Array<Record<string, unknown>> | undefined
    return (branches ?? [body]).map(resolve)
  }

  it('documents both the compose request and the existing-message request', () => {
    const branches = requestBodyBranches()
    const required = branches.map((branch) => (branch.required as string[] | undefined) ?? [])

    expect(branches).toHaveLength(2)
    expect(required).toEqual(expect.arrayContaining([
      expect.arrayContaining(['userChannelId', 'messageId']),
      expect.arrayContaining(['userChannelId', 'to']),
    ]))
  })
})
