/** @jest-environment node */

import { finalizeIntegrationsReadResponse, integrationApiRoutePaths, runIntegrationsReadBeforeInterceptors } from '../umes-read'
import { runApiInterceptorsAfter, runApiInterceptorsBefore } from '@open-mercato/shared/lib/crud/interceptor-runner'
import { applyResponseEnrichers, applyResponseEnricherToRecord } from '@open-mercato/shared/lib/crud/enricher-runner'

jest.mock('@open-mercato/shared/lib/crud/interceptor-runner', () => ({
  runApiInterceptorsBefore: jest.fn(),
  runApiInterceptorsAfter: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/enricher-runner', () => ({
  applyResponseEnrichers: jest.fn(),
  applyResponseEnricherToRecord: jest.fn(),
}))

describe('integrations read-route UMES helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('passes route/query/header context into read interceptors', async () => {
    ;(runApiInterceptorsBefore as jest.Mock).mockResolvedValue({
      ok: true,
      request: { method: 'GET', url: 'http://localhost/api/integrations/logs?page=2', headers: {}, query: { page: '2' } },
      metadataByInterceptor: {},
    })

    const request = new Request('http://localhost/api/integrations/logs?page=2', {
      headers: { 'x-test': '1' },
    })

    await runIntegrationsReadBeforeInterceptors({
      routePath: integrationApiRoutePaths.logs,
      request,
      auth: { tenantId: 'tenant-1', orgId: 'org-1', sub: 'user-1', features: ['integrations.view'] },
      container: { resolve: jest.fn(() => ({})) } as any,
    })

    expect(runApiInterceptorsBefore).toHaveBeenCalledWith(
      expect.objectContaining({
        routePath: integrationApiRoutePaths.logs,
        method: 'GET',
        request: expect.objectContaining({
          query: { page: '2' },
          headers: expect.objectContaining({ 'x-test': '1' }),
        }),
      }),
    )
  })

  it('keeps base fields intact while allowing additive interceptor/enricher data', async () => {
    ;(runApiInterceptorsAfter as jest.Mock).mockResolvedValue({
      ok: true,
      statusCode: 200,
      headers: {},
      body: {
        items: [{ id: 'int-1', title: 'Overwritten title' }],
        total: 999,
        _meta: { intercepted: true },
      },
    })
    ;(applyResponseEnrichers as jest.Mock).mockResolvedValue({
      items: [{ id: 'int-1', title: 'Also overwritten', _provider: { healthy: true } }],
      _meta: { enrichedBy: ['example.test'] },
    })

    const response = await finalizeIntegrationsReadResponse({
      routePath: integrationApiRoutePaths.list,
      request: new Request('http://localhost/api/integrations'),
      auth: { tenantId: 'tenant-1', orgId: 'org-1', sub: 'user-1', features: ['integrations.view'] },
      container: { resolve: jest.fn(() => ({})) } as any,
      interceptorRequest: {
        method: 'GET',
        url: 'http://localhost/api/integrations',
        headers: {},
        query: {},
      },
      body: {
        items: [{ id: 'int-1', title: 'Original title' }],
        total: 1,
      },
      enrich: {
        targetEntity: 'integrations.integration',
        listKeys: ['items'],
      },
    })

    const json = await response.json()
    expect(json).toEqual({
      items: [{ id: 'int-1', title: 'Original title', _provider: { healthy: true } }],
      total: 1,
      _meta: { intercepted: true },
    })
  })

  it('applies additive detail enrichers without allowing record overwrite', async () => {
    ;(runApiInterceptorsAfter as jest.Mock).mockResolvedValue({
      ok: true,
      statusCode: 200,
      headers: {},
      body: {},
    })
    ;(applyResponseEnricherToRecord as jest.Mock).mockResolvedValue({
      record: {
        id: 'gateway_stripe',
        title: 'Changed',
        _provider: { diagnostics: true },
      },
      _meta: { enrichedBy: ['example.detail'] },
    })

    const response = await finalizeIntegrationsReadResponse({
      routePath: integrationApiRoutePaths.detail,
      request: new Request('http://localhost/api/integrations/gateway_stripe'),
      auth: { tenantId: 'tenant-1', orgId: 'org-1', sub: 'user-1', features: ['integrations.view'] },
      container: { resolve: jest.fn(() => ({})) } as any,
      interceptorRequest: {
        method: 'GET',
        url: 'http://localhost/api/integrations/gateway_stripe',
        headers: {},
        query: {},
      },
      body: {
        integration: {
          id: 'gateway_stripe',
          title: 'Stripe',
        },
      },
      enrich: {
        targetEntity: 'integrations.integration',
        recordKeys: ['integration'],
      },
    })

    const json = await response.json()
    expect(json).toEqual({
      integration: {
        id: 'gateway_stripe',
        title: 'Stripe',
        _provider: { diagnostics: true },
      },
    })
  })
})
