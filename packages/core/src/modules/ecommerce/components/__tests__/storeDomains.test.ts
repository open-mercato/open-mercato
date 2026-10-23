import { describeDomainFailureReason } from '../storeDomains'

describe('describeDomainFailureReason', () => {
  it.each([
    ['HTTP 502', 'ecommerce.backend.store.domains.failure.httpStatus', { status: '502' }],
    ['TLS health check timed out', 'ecommerce.backend.store.domains.failure.tlsTimeout', {}],
    ['TLS health check failed', 'ecommerce.backend.store.domains.failure.tlsFailed', {}],
    ['DNS lookup error (CNAME): queryCname ENOTFOUND', 'ecommerce.backend.store.domains.failure.dnsLookup', { recordType: 'CNAME' }],
    [
      'CNAME points to a.example.net instead of edge.example.com',
      'ecommerce.backend.store.domains.failure.cnameMismatch',
      { actual: 'a.example.net', expected: 'edge.example.com' },
    ],
    ['No CNAME or A record found for shop.example.com', 'ecommerce.backend.store.domains.failure.noRecords', {}],
    [
      'A record points to a known proxy IP, but reverse-resolve over HTTPS did not reach our server',
      'ecommerce.backend.store.domains.failure.proxyUnreachable',
      {},
    ],
    [
      'A record points to 1.2.3.4 instead of 5.6.7.8',
      'ecommerce.backend.store.domains.failure.aRecordMismatch',
      { actual: '1.2.3.4', expected: '5.6.7.8' },
    ],
    [
      'A record points to 1.2.3.4 but apex-domain registration is not enabled on this deployment',
      'ecommerce.backend.store.domains.failure.apexNotEnabled',
      { actual: '1.2.3.4' },
    ],
  ])('maps %s to a translation key', (reason, key, params) => {
    expect(describeDomainFailureReason(reason)).toEqual(expect.objectContaining({ key, params }))
  })

  it('returns null for an unknown reason so the raw text is shown', () => {
    expect(describeDomainFailureReason('Certificate request rejected')).toBeNull()
  })
})
