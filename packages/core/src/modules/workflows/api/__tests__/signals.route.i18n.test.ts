/**
 * Correlation-key signal route — localized delivery failure (#7185).
 *
 * An instance that fails for an internal reason is reported as
 * `SIGNAL_DELIVERY_FAILED` with a generic message. The code is the stable
 * contract; the message is caller-facing and resolved in the request locale
 * through the real signal handler and the real i18n stack.
 */

import { NextRequest } from 'next/server'
import { registerModules } from '@open-mercato/shared/lib/i18n/server'
import type { Module } from '@open-mercato/shared/modules/registry'
import en from '../../i18n/en.json'
import pl from '../../i18n/pl.json'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: jest.fn(),
}))

import { POST as sendByCorrelationKey } from '../signals/route'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { sendSignalByCorrelationResponseSchema } from '../openapi'

const testTenantId = 'tenant-1'
const testOrgId = 'org-1'
const failedInstanceId = '22222222-2222-4222-8222-222222222222'

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/workflows/signals', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/workflows/signals — localized SIGNAL_DELIVERY_FAILED', () => {
  const previousForcedLocale = process.env.OM_FORCE_LOCALE

  beforeAll(() => {
    registerModules([{ id: 'workflows', translations: { en, pl } } as unknown as Module])
  })

  afterEach(() => {
    if (previousForcedLocale === undefined) delete process.env.OM_FORCE_LOCALE
    else process.env.OM_FORCE_LOCALE = previousForcedLocale
  })

  beforeEach(() => {
    jest.clearAllMocks()
    const rbac = { userHasAllFeatures: jest.fn().mockResolvedValue(true) }
    const { createRequestContainer } = require('@open-mercato/shared/lib/di/container')
    createRequestContainer.mockResolvedValue({
      resolve: (name: string) => (name === 'em' ? {} : name === 'rbacService' ? rbac : null),
    })
    const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: testTenantId, orgId: testOrgId })
    const { resolveOrganizationScopeForRequest } = require('@open-mercato/core/modules/directory/utils/organizationScope')
    resolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: testOrgId })

    ;(findWithDecryption as jest.Mock).mockResolvedValue([
      { id: failedInstanceId, status: 'PAUSED', currentStepId: 'wait_approval', waitVersion: 3 },
    ])
    ;(findOneWithDecryption as jest.Mock).mockRejectedValue(new Error('connection terminated unexpectedly'))
  })

  async function deliver() {
    const response = await sendByCorrelationKey(
      makeRequest({ correlationKey: 'batch-pl', signalName: 'approval_granted' }),
    )
    return { status: response.status, body: await response.json() }
  }

  it('answers the generic failure in Polish while keeping the stable code', async () => {
    process.env.OM_FORCE_LOCALE = 'pl'

    const { status, body } = await deliver()

    expect(status).toBe(200)
    expect(body.count).toBe(0)
    expect(body.failures).toEqual([
      { instanceId: failedInstanceId, code: 'SIGNAL_DELIVERY_FAILED', message: pl['workflows.signals.errors.deliveryFailed'] },
    ])
    expect(body.failures[0].message).not.toBe(en['workflows.signals.errors.deliveryFailed'])
    expect(JSON.stringify(body)).not.toContain('connection terminated')
    expect(sendSignalByCorrelationResponseSchema.safeParse(body).success).toBe(true)
  })

  it('answers in English for the default locale', async () => {
    process.env.OM_FORCE_LOCALE = 'en'

    const { body } = await deliver()

    expect(body.failures[0]).toEqual({
      instanceId: failedInstanceId,
      code: 'SIGNAL_DELIVERY_FAILED',
      message: en['workflows.signals.errors.deliveryFailed'],
    })
  })
})
