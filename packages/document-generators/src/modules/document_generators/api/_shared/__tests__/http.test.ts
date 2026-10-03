import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  resetTelemetryRuntime,
  registerTelemetryRuntime,
  type TelemetryRuntime,
} from '@open-mercato/shared/lib/telemetry/runtime'
import { TemplateAccessDeniedError } from '../../../lib/template-access-policy'
import { UnknownTemplateError } from '../../../lib/template-registry'
import { errorResponse, mapDocumentError, parseJsonBody, requireOrganization } from '../http'

const translate = (key: string, fallback?: string) => `T:${key}|${fallback ?? ''}`

describe('errorResponse', () => {
  it('builds the envelope with a translated message and extras', async () => {
    const response = errorResponse('forbidden', 403, translate, { requiredFeatures: ['a.b'] })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: 'forbidden',
      message: 'T:document_generators.errors.forbidden|You do not have permission to access this document.',
      requiredFeatures: ['a.b'],
    })
  })
})

describe('parseJsonBody', () => {
  it('returns the parsed body', async () => {
    const request = new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ a: 1 }) })
    expect(await parseJsonBody(request, translate)).toEqual({ ok: true, body: { a: 1 } })
  })

  it('answers 400 invalid_json for a malformed body', async () => {
    const request = new Request('http://localhost/x', { method: 'POST', body: '{nope' })
    const result = await parseJsonBody(request, translate)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(400)
      expect((await result.response.json()).error).toBe('invalid_json')
    }
  })
})

describe('requireOrganization', () => {
  it('returns the tenant and organization pair', () => {
    expect(requireOrganization({ sub: 'u', tenantId: 't', orgId: 'o' }, translate)).toEqual({
      ok: true,
      scope: { tenantId: 't', organizationId: 'o' },
    })
  })

  it.each([
    ['null auth', null],
    ['missing tenant', { sub: 'u', tenantId: null, orgId: 'o' }],
    ['missing organization', { sub: 'u', tenantId: 't', orgId: null }],
  ])('answers 409 organization_required for %s', async (_name, auth) => {
    const result = requireOrganization(auth, translate)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(409)
      expect((await result.response.json()).error).toBe('organization_required')
    }
  })
})

describe('mapDocumentError', () => {
  const logger = { error: jest.fn() }
  const reportError = jest.fn()

  beforeEach(() => {
    logger.error.mockReset()
    reportError.mockReset()
    registerTelemetryRuntime({ reportError } as unknown as TelemetryRuntime)
  })

  afterEach(() => resetTelemetryRuntime())

  async function map(error: unknown) {
    const response = mapDocumentError(error, translate, logger)
    return { status: response.status, body: await response.json() }
  }

  it('maps UnknownTemplateError to 400 unknown_template', async () => {
    const { status, body } = await map(new UnknownTemplateError('x'))
    expect(status).toBe(400)
    expect(body.error).toBe('unknown_template')
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('maps TemplateAccessDeniedError to 403 with requiredFeatures', async () => {
    const { status, body } = await map(new TemplateAccessDeniedError(['sales.orders.view']))
    expect(status).toBe(403)
    expect(body.error).toBe('forbidden')
    expect(body.requiredFeatures).toEqual(['sales.orders.view'])
  })

  it.each([
    ['invalid_request', 400, 'invalid_request'],
    ['not_found', 404, 'not_found'],
    ['organization_scope_required', 409, 'organization_required'],
  ])('maps source CrudHttpError %s', async (sourceCode, expectedStatus, expectedCode) => {
    const { status, body } = await map(new CrudHttpError(sourceCode === 'not_found' ? 404 : 400, { error: sourceCode }))
    expect(status).toBe(expectedStatus)
    expect(body.error).toBe(expectedCode)
    expect(body.message).toContain(`document_generators.errors.${expectedCode}`)
    expect(reportError).not.toHaveBeenCalled()
  })

  it('answers 500 render_failed for unknown errors without leaking the cause', async () => {
    const cause = new Error('secret database password leaked')
    const { status, body } = await map(cause)
    expect(status).toBe(500)
    expect(body.error).toBe('render_failed')
    expect(JSON.stringify(body)).not.toContain('secret')
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(reportError).toHaveBeenCalledWith(cause, expect.objectContaining({ module: 'document_generators' }))
  })

  it('answers 500 for a CrudHttpError with an unmapped code', async () => {
    const { status, body } = await map(new CrudHttpError(500, { error: 'boom' }))
    expect(status).toBe(500)
    expect(body.error).toBe('render_failed')
    expect(reportError).toHaveBeenCalled()
  })

  it('still answers 500 when telemetry reporting throws', async () => {
    reportError.mockImplementation(() => {
      throw new Error('sink down')
    })
    const { status } = await map(new Error('x'))
    expect(status).toBe(500)
    expect(logger.error).toHaveBeenCalledTimes(2)
  })
})
