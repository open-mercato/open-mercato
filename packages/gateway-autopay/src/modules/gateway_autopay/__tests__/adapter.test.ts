import { autopayAdapterV1 } from '../lib/adapters/v1'
import { computeAutopayHash } from '../lib/hash'
import { deriveMessageId } from '../lib/autopay-client'
import { cancelResponseXml, refundResponseXml, statusResponseXml, transactionXml } from './support/autopay-xml'

const credentials = {
  serviceId: '2',
  sharedKey: '2test2',
  gatewayUrl: 'https://testpay.autopay.eu/sciezka',
}

describe('autopayAdapterV1.createSession', () => {
  it('rejects non-PLN currencies before building anything', async () => {
    await expect(autopayAdapterV1.createSession({
      paymentId: 'pay-1',
      tenantId: 't1',
      organizationId: 'o1',
      amount: 10,
      currencyCode: 'EUR',
      credentials,
      metadata: { customerEmail: 'buyer@example.com' },
    })).rejects.toThrow(/PLN/)
  })

  it('rejects a session missing the required customer email', async () => {
    await expect(autopayAdapterV1.createSession({
      paymentId: 'pay-1',
      tenantId: 't1',
      organizationId: 'o1',
      amount: 10,
      currencyCode: 'PLN',
      credentials,
    })).rejects.toThrow(/customerEmail/)
  })

  it('builds a signed launch session without any outbound HTTP call', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch')
    const result = await autopayAdapterV1.createSession({
      paymentId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      tenantId: 't1',
      organizationId: 'o1',
      amount: 1.5,
      currencyCode: 'PLN',
      credentials,
      metadata: { customerEmail: 'buyer@example.com' },
      successUrl: 'https://shop.example.com/pay/s/success/abc',
      cancelUrl: 'https://shop.example.com/pay/s/cancel/abc',
    })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.status).toBe('pending')
    expect(result.sessionId).toHaveLength(32)
    const providerData = result.providerData as {
      formPost: { url: string; fields: Record<string, string> }
      launch: { token: string; expiresAt: string }
      returnTargets: { successUrl: string | null; cancelUrl: string | null }
    }
    expect(result.redirectUrl).toBe(
      `https://shop.example.com/api/gateway_autopay/launch?o=${result.sessionId}&t=${providerData.launch.token}`,
    )
    expect(providerData.formPost.url).toBe(credentials.gatewayUrl)
    expect(providerData.formPost.fields.CustomerEmail).toBe('buyer@example.com')
    expect(providerData.returnTargets).toEqual({
      successUrl: 'https://shop.example.com/pay/s/success/abc',
      cancelUrl: 'https://shop.example.com/pay/s/cancel/abc',
    })
    fetchSpy.mockRestore()
  })

  it('never puts the payer email, the signature or the gateway host in the redirect URL', async () => {
    const result = await autopayAdapterV1.createSession({
      paymentId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      tenantId: 't1',
      organizationId: 'o1',
      amount: 1.5,
      currencyCode: 'PLN',
      credentials,
      metadata: { customerEmail: 'buyer@example.com' },
      successUrl: 'https://shop.example.com/pay/s/success/abc',
    })

    expect(result.redirectUrl).not.toContain('buyer')
    expect(result.redirectUrl).not.toContain('Hash')
    expect(result.redirectUrl).not.toContain(new URL(credentials.gatewayUrl).host)
    expect(new URL(result.redirectUrl as string).searchParams.get('t')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect([...new URL(result.redirectUrl as string).searchParams.keys()].sort()).toEqual(['o', 't'])
  })

  it('issues a different unguessable launch token for every session', async () => {
    const input = {
      paymentId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      tenantId: 't1',
      organizationId: 'o1',
      amount: 1.5,
      currencyCode: 'PLN',
      credentials,
      metadata: { customerEmail: 'buyer@example.com' },
    }
    const first = await autopayAdapterV1.createSession(input)
    const second = await autopayAdapterV1.createSession(input)

    const tokens = [first, second].map((session) => (session.providerData as { launch: { token: string } }).launch.token)
    expect(tokens[0]).not.toBe(tokens[1])
    expect(tokens[0]).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('falls back to a relative launch path when the caller supplies no absolute success URL', async () => {
    const result = await autopayAdapterV1.createSession({
      paymentId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      tenantId: 't1',
      organizationId: 'o1',
      amount: 1.5,
      currencyCode: 'PLN',
      credentials,
      metadata: { customerEmail: 'buyer@example.com' },
    })

    expect(result.redirectUrl).toMatch(/^\/api\/gateway_autopay\/launch\?o=/)
  })
})

describe('autopayAdapterV1.capture', () => {
  it('always fails closed — Autopay has no separate capture step', async () => {
    await expect(autopayAdapterV1.capture({ sessionId: 'x', credentials })).rejects.toThrow(/capturing/i)
  })
})

describe('autopayAdapterV1.verifyWebhook', () => {
  it('fails closed — ITN handling is deferred to a follow-up spec', async () => {
    await expect(autopayAdapterV1.verifyWebhook({ rawBody: '', headers: {}, credentials }))
      .rejects.toThrow(/follow-up spec/)
  })
})

describe('autopayAdapterV1.getStatus', () => {
  afterEach(() => jest.restoreAllMocks())

  it('reports captured for a single SUCCESS transaction, sourcing amount and amountReceived from the same record', async () => {
    const xml = statusResponseXml([
      { orderID: '100', remoteID: 'r1', amount: '1.50', currency: 'PLN', paymentDate: '20260910120000', paymentStatus: 'SUCCESS', paymentStatusDetails: 'AUTHORIZED' },
    ])
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(xml, { status: 200 }))

    const status = await autopayAdapterV1.getStatus({ sessionId: '100', credentials })
    expect(status.status).toBe('captured')
    expect(status.amount).toBe(1.5)
    expect(status.amountReceived).toBe(1.5)
    expect(status.currencyCode).toBe('PLN')
  })

  it('reports pending when only a PENDING transaction exists', async () => {
    const xml = statusResponseXml([
      { orderID: '100', remoteID: 'r1', amount: '1.50', currency: 'PLN', paymentDate: '20260910120000', paymentStatus: 'PENDING' },
    ])
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(xml, { status: 200 }))

    const status = await autopayAdapterV1.getStatus({ sessionId: '100', credentials })
    expect(status.status).toBe('pending')
  })

  it('does not throw for a reason-bearing, zero-transaction response — reports unknown, not unhealthy', async () => {
    const hash = computeAutopayHash(['2'], '2test2')
    const xml = `<?xml version="1.0"?><transactionList><serviceID>2</serviceID><transactions></transactions><reason>NOT_FOUND</reason><hash>${hash}</hash></transactionList>`
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(xml, { status: 200 }))

    const status = await autopayAdapterV1.getStatus({ sessionId: 'missing-order', credentials })
    expect(status.status).toBe('unknown')
    expect(status.providerData?.reason).toBe('NOT_FOUND')
  })

  it('rejects a zero-transaction status response with an invalid hash', async () => {
    const xml = '<?xml version="1.0"?><transactionList><serviceID>2</serviceID><transactions></transactions><hash>not-a-real-hash</hash></transactionList>'
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(xml, { status: 200 }))

    await expect(autopayAdapterV1.getStatus({ sessionId: 'missing-order', credentials })).rejects.toThrow(/hash verification/)
  })

  it('rejects a status response whose hash does not verify', async () => {
    const xml = '<?xml version="1.0"?><transactionList><serviceID>2</serviceID><transactions>' +
      transactionXml({ orderID: '100', remoteID: 'r1', amount: '1.50', currency: 'PLN', paymentDate: '20260910120000', paymentStatus: 'SUCCESS' }) +
      '</transactions><hash>not-a-real-hash</hash></transactionList>'
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(xml, { status: 200 }))

    await expect(autopayAdapterV1.getStatus({ sessionId: '100', credentials })).rejects.toThrow(/hash verification/)
  })
})

describe('autopayAdapterV1.cancel', () => {
  afterEach(() => jest.restoreAllMocks())

  it('cancels a still-pending transaction', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const body = new URLSearchParams(String((init as RequestInit).body))
      const messageId = body.get('MessageID') ?? 'm1'
      return new Response(cancelResponseXml({ confirmation: 'CONFIRMED', reason: 'CANCELED_FULLY', messageId }), { status: 200 })
    })

    const result = await autopayAdapterV1.cancel({ sessionId: '100', credentials })
    expect(result.status).toBe('cancelled')
  })

  it('fails closed when Autopay refuses to cancel (e.g. already settled)', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const body = new URLSearchParams(String((init as RequestInit).body))
      const messageId = body.get('MessageID') ?? 'm1'
      return new Response(cancelResponseXml({ confirmation: 'NOTCONFIRMED', reason: 'ALREADY_SETTLED', messageId }), { status: 200 })
    })

    await expect(autopayAdapterV1.cancel({ sessionId: '100', credentials })).rejects.toThrow(/already be settled/)
  })

  it('rejects a cancel acknowledgment whose hash does not verify', async () => {
    const xml = '<?xml version="1.0"?><transaction><serviceID>2</serviceID><messageID>m1</messageID><confirmation>CONFIRMED</confirmation><hash>not-a-real-hash</hash></transaction>'
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(xml, { status: 200 }))

    await expect(autopayAdapterV1.cancel({ sessionId: '100', credentials })).rejects.toThrow(/hash verification/)
  })

  it('reconciles a CANCELED_PARTIALLY confirmation to captured when a settled attempt is found', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).includes('transactionCancel')) {
        const body = new URLSearchParams(String((init as RequestInit).body))
        const messageId = body.get('MessageID') ?? 'm1'
        return new Response(cancelResponseXml({ confirmation: 'CONFIRMED', reason: 'CANCELED_PARTIALLY', messageId }), { status: 200 })
      }
      return new Response(statusResponseXml([
        { orderID: '100', remoteID: 'r1', amount: '1.50', currency: 'PLN', paymentDate: '20260910120000', paymentStatus: 'SUCCESS' },
      ]), { status: 200 })
    })

    const result = await autopayAdapterV1.cancel({ sessionId: '100', credentials })
    expect(result.status).toBe('captured')
    expect(result.providerData?.reconciledAfterPartialCancel).toBe(true)
  })

  it('fails closed on CANCELED_PARTIALLY when reconciliation finds no settled attempt — never claims cancelled', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).includes('transactionCancel')) {
        const body = new URLSearchParams(String((init as RequestInit).body))
        const messageId = body.get('MessageID') ?? 'm1'
        return new Response(cancelResponseXml({ confirmation: 'CONFIRMED', reason: 'CANCELED_PARTIALLY', messageId }), { status: 200 })
      }
      return new Response(statusResponseXml([
        { orderID: '100', remoteID: 'r1', amount: '1.50', currency: 'PLN', paymentDate: '20260910120000', paymentStatus: 'PENDING' },
      ]), { status: 200 })
    })

    await expect(autopayAdapterV1.cancel({ sessionId: '100', credentials })).rejects.toThrow(/partially cancelled/)
  })

  it('reuses the same MessageID for two cancels sharing an idempotencyKey', async () => {
    const sentFields: Record<string, string>[] = []
    jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const body = new URLSearchParams(String((init as RequestInit).body))
      const fields = Object.fromEntries(body.entries())
      sentFields.push(fields)
      return new Response(cancelResponseXml({ confirmation: 'CONFIRMED', reason: 'CANCELED_FULLY', messageId: fields.MessageID }), { status: 200 })
    })

    await autopayAdapterV1.cancel({ sessionId: '100', credentials, idempotencyKey: 'op-1' })
    await autopayAdapterV1.cancel({ sessionId: '100', credentials, idempotencyKey: 'op-1' })

    expect(sentFields).toHaveLength(2)
    expect(sentFields[0].MessageID).toBe(sentFields[1].MessageID)
    expect(sentFields[0].MessageID).toBe(deriveMessageId('op-1'))
  })
})

describe('autopayAdapterV1.refund', () => {
  afterEach(() => jest.restoreAllMocks())

  it('acknowledges without claiming a refund: payment stays captured, nothing refunded, refund pending in providerData', async () => {
    const messageId = deriveMessageId('refund-op-1')
    const xml = refundResponseXml({ messageId })
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(xml, { status: 200 }))

    const result = await autopayAdapterV1.refund({
      sessionId: '100',
      amount: 1.5,
      credentials,
      metadata: { remoteId: 'r1' },
      idempotencyKey: 'refund-op-1',
    })

    expect(result.status).toBe('captured')
    expect(result.refundedAmount).toBe(0)
    expect(result.refundId).toBe(messageId)
    expect(result.providerData).toMatchObject({ refundStatus: 'pending', requestedAmount: 1.5, acknowledged: true })
  })

  it('resolves the remoteId itself via transactionStatus when the caller does not supply metadata.remoteId — the real gateway service never does', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).includes('transactionStatus')) {
        return new Response(statusResponseXml([
          { orderID: '100', remoteID: 'r-auto', amount: '1.50', currency: 'PLN', paymentDate: '20260910120000', paymentStatus: 'SUCCESS' },
        ]), { status: 200 })
      }
      const body = new URLSearchParams(String((init as RequestInit).body))
      const messageId = body.get('MessageID') ?? 'm1'
      return new Response(refundResponseXml({ messageId }), { status: 200 })
    })

    const result = await autopayAdapterV1.refund({ sessionId: '100', amount: 1.5, credentials })
    expect(result.status).toBe('captured')
    expect(result.providerData).toMatchObject({ refundStatus: 'pending' })
  })

  it('fails closed when self-resolving remoteId finds no captured transaction', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(statusResponseXml([
      { orderID: '100', remoteID: 'r1', amount: '1.50', currency: 'PLN', paymentDate: '20260910120000', paymentStatus: 'PENDING' },
    ]), { status: 200 }))

    await expect(autopayAdapterV1.refund({ sessionId: '100', credentials })).rejects.toThrow(/no captured transaction/)
  })

  it('reuses the same MessageID for two refunds sharing an idempotencyKey', async () => {
    const sentFields: Record<string, string>[] = []
    jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const body = new URLSearchParams(String((init as RequestInit).body))
      const fields = Object.fromEntries(body.entries())
      sentFields.push(fields)
      return new Response(refundResponseXml({ messageId: fields.MessageID }), { status: 200 })
    })

    const input = { sessionId: '100', amount: 1.5, credentials, metadata: { remoteId: 'r1' }, idempotencyKey: 'refund-op-2' }
    await autopayAdapterV1.refund(input)
    await autopayAdapterV1.refund(input)

    expect(sentFields).toHaveLength(2)
    expect(sentFields[0].MessageID).toBe(sentFields[1].MessageID)
    expect(sentFields[0].Currency).toBe('PLN')
  })

  it('rejects a refund acknowledgment that echoes a different MessageID than the one sent', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(refundResponseXml({ messageId: 'a-completely-different-id' }), { status: 200 }))

    await expect(autopayAdapterV1.refund({
      sessionId: '100',
      amount: 1.5,
      credentials,
      metadata: { remoteId: 'r1' },
      idempotencyKey: 'refund-op-3',
    })).rejects.toThrow(/different MessageID/)
  })
})
