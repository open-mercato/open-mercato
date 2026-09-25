import { autopayAdapterV1 } from '../lib/adapters/v1'
import { computeAutopayHash } from '../lib/hash'
import { deriveMessageId } from '../lib/autopay-client'

const credentials = {
  serviceId: '2',
  sharedKey: '2test2',
  gatewayUrl: 'https://testpay.autopay.eu/sciezka',
}

function transactionXml(fields: {
  orderID: string
  remoteID: string
  amount: string
  currency: string
  gatewayID?: string
  paymentDate: string
  paymentStatus: string
  paymentStatusDetails?: string
}): string {
  return (
    '<transaction>' +
    `<orderID>${fields.orderID}</orderID>` +
    `<remoteID>${fields.remoteID}</remoteID>` +
    `<amount>${fields.amount}</amount>` +
    `<currency>${fields.currency}</currency>` +
    `<gatewayID>${fields.gatewayID ?? ''}</gatewayID>` +
    `<paymentDate>${fields.paymentDate}</paymentDate>` +
    `<paymentStatus>${fields.paymentStatus}</paymentStatus>` +
    `<paymentStatusDetails>${fields.paymentStatusDetails ?? ''}</paymentStatusDetails>` +
    '</transaction>'
  )
}

function statusResponseXml(transactions: Parameters<typeof transactionXml>[0][]): string {
  const chainFields = ['2', ...transactions.flatMap((t) => [
    t.orderID, t.remoteID, t.amount, t.currency, t.gatewayID ?? '', t.paymentDate, t.paymentStatus, t.paymentStatusDetails ?? '',
  ])]
  const hash = computeAutopayHash(chainFields, '2test2')
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<transactionList><serviceID>2</serviceID><transactions>' +
    transactions.map(transactionXml).join('') +
    `</transactions><hash>${hash}</hash></transactionList>`
  )
}

function cancelResponseXml(opts: { confirmation: string; reason?: string; serviceId?: string; messageId?: string }): string {
  const serviceId = opts.serviceId ?? '2'
  const messageId = opts.messageId ?? 'm1'
  const hash = computeAutopayHash([serviceId, messageId, opts.confirmation, opts.reason], '2test2')
  return (
    '<?xml version="1.0"?><transaction>' +
    `<serviceID>${serviceId}</serviceID><messageID>${messageId}</messageID>` +
    `<confirmation>${opts.confirmation}</confirmation>` +
    (opts.reason ? `<reason>${opts.reason}</reason>` : '') +
    `<hash>${hash}</hash></transaction>`
  )
}

function refundResponseXml(opts: { serviceId?: string; messageId: string }): string {
  const serviceId = opts.serviceId ?? '2'
  const hash = computeAutopayHash([serviceId, opts.messageId], '2test2')
  return `<?xml version="1.0"?><transactionRefund><serviceID>${serviceId}</serviceID><messageID>${opts.messageId}</messageID><hash>${hash}</hash></transactionRefund>`
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

  it('builds a signed redirect without any outbound HTTP call', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch')
    const result = await autopayAdapterV1.createSession({
      paymentId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      tenantId: 't1',
      organizationId: 'o1',
      amount: 1.5,
      currencyCode: 'PLN',
      credentials,
      metadata: { customerEmail: 'buyer@example.com' },
    })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.status).toBe('pending')
    expect(result.sessionId).toHaveLength(32)
    expect(result.redirectUrl).toContain(credentials.gatewayUrl)
    fetchSpy.mockRestore()
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

  it('returns a pending status from the synchronous acknowledgment, never "refunded"', async () => {
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

    expect(result.status).toBe('pending')
    expect(result.refundId).toBe(messageId)
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
    expect(result.status).toBe('pending')
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
