import { resolveInboundReceiptMessageId } from '../route'

describe('resolveInboundReceiptMessageId', () => {
  it('prefers explicit webhook ids when present', () => {
    expect(
      resolveInboundReceiptMessageId({
        endpointId: 'mock_inbound',
        providerKey: 'mock',
        headers: {
          'webhook-id': 'msg-123',
          'webhook-timestamp': '1700000000',
        },
        body: '{"ok":true}',
      })
    ).toBe('msg-123')
  })

  it('derives a stable fallback id from provider, endpoint, timestamp, and body', () => {
    const first = resolveInboundReceiptMessageId({
      endpointId: 'mock_inbound',
      providerKey: 'mock',
      headers: {
        'webhook-timestamp': '1700000000',
      },
      body: '{"ok":true}',
    })

    const second = resolveInboundReceiptMessageId({
      endpointId: 'mock_inbound',
      providerKey: 'mock',
      headers: {
        'webhook-timestamp': '1700000000',
      },
      body: '{"ok":true}',
    })

    expect(first).toBe(second)
    expect(first).toMatch(/^derived:1700000000:/)
  })

  it('changes when timestamp changes', () => {
    const first = resolveInboundReceiptMessageId({
      endpointId: 'mock_inbound',
      providerKey: 'mock',
      headers: {
        'webhook-timestamp': '1700000000',
      },
      body: '{"ok":true}',
    })

    const second = resolveInboundReceiptMessageId({
      endpointId: 'mock_inbound',
      providerKey: 'mock',
      headers: {
        'webhook-timestamp': '1700000001',
      },
      body: '{"ok":true}',
    })

    expect(first).not.toBe(second)
  })
})
