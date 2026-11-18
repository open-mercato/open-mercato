/** @jest-environment node */
const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const LEASE = '33333333-3333-4333-8333-333333333333'
const UNIT = '44444444-4444-4444-8444-444444444444'
const COMPANY = '55555555-5555-4555-8555-555555555555'

jest.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) },
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (key: string, fallback?: string) => `t:${key}:${fallback ?? ''}` })),
}))
jest.mock('../api/routeContext', () => {
  const actual = jest.requireActual('../api/routeContext')
  return {
    ...actual,
    resolveStaffContext: jest.fn(async () => ({
      ctx: { container: { resolve: () => null } },
      em: {},
      tenantId: TENANT,
      organizationId: ORG,
      userId: 'user-1',
      translate: (key: string, fallback?: string) => `t:${key}:${fallback ?? ''}`,
      permitted: null,
    })),
    runStaffGuard: jest.fn(),
  }
})

import { z } from 'zod'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { handleRouteError } from '../api/routeContext'
import { POST as extendLease } from '../api/leases/[id]/extensions/route'
import { POST as createLease } from '../api/leases/route'
import { translateZodFieldErrors } from '../lib/zodFieldErrors'

type RouteResult = { status: number; body: Record<string, unknown> }

const GENERIC = 't:property_management.errors.invalidInput:Invalid input'
const TOO_PRECISE = `t:property_management.errors.rateTooPrecise:${GENERIC}`

function jsonRequest(url: string, body: Record<string, unknown>): Request {
  return new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

describe('handleRouteError validation responses', () => {
  it('returns translated field errors and no raw zod issues', async () => {
    const schema = z.object({ monthlyRate: z.string().refine(() => false, 'property_management.errors.rateTooPrecise'), unitId: z.string().uuid() })
    const parsed = schema.safeParse({ monthlyRate: '1.23456', unitId: 'not-a-uuid' })
    const response = (await handleRouteError(parsed.error, 'test')) as unknown as RouteResult
    expect(response.status).toBe(400)
    expect(response.body).toEqual({ error: GENERIC, fieldErrors: { monthlyRate: TOO_PRECISE, unitId: GENERIC } })
    expect(response.body).not.toHaveProperty('issues')
  })

  it('keeps the status and body of a CrudHttpError', async () => {
    const response = (await handleRouteError(new CrudHttpError(409, { error: 'Conflict', code: 'lease_overlap' }), 'test')) as unknown as RouteResult
    expect(response.status).toBe(409)
    expect(response.body).toMatchObject({ code: 'lease_overlap' })
  })
})

describe('translateZodFieldErrors', () => {
  const translate = (key: string, fallback?: string) => `t:${key}:${fallback ?? ''}`

  it('prefers a module message over a generic one on the same field', () => {
    const schema = z.object({ rate: z.string().min(5).refine(() => false, 'property_management.errors.rateInvalid') })
    const parsed = schema.safeParse({ rate: 'a' })
    expect(translateZodFieldErrors(parsed.error!, translate)).toEqual({ rate: `t:property_management.errors.rateInvalid:${GENERIC}` })
  })

  it('reports root issues on the form key and never leaks zod English', () => {
    const parsed = z.string().safeParse(12)
    expect(translateZodFieldErrors(parsed.error!, translate)).toEqual({ form: GENERIC })
  })
})

describe('lease routes refuse a too-precise monthly rate on the monthlyRate field', () => {
  it('lease create', async () => {
    const response = (await createLease(jsonRequest('http://localhost/api/property_management/leases', {
      unitId: UNIT,
      customerCompanyId: COMPANY,
      startsOn: '2030-01-01',
      termMonths: 12,
      monthlyRate: '1000.12345',
    }))) as unknown as RouteResult
    expect(response.status).toBe(400)
    expect(response.body.fieldErrors).toEqual({ monthlyRate: TOO_PRECISE })
    expect(response.body).not.toHaveProperty('issues')
  })

  it('lease extend', async () => {
    const response = (await extendLease(
      jsonRequest(`http://localhost/api/property_management/leases/${LEASE}/extensions`, { months: 6, monthlyRate: 1400.00001, asProposal: false }),
      { params: Promise.resolve({ id: LEASE }) },
    )) as unknown as RouteResult
    expect(response.status).toBe(400)
    expect(response.body.fieldErrors).toEqual({ monthlyRate: TOO_PRECISE })
    expect(response.body).not.toHaveProperty('issues')
  })
})
