import { autopayAdapterV1 } from '../lib/adapters/v1'
import { computeAutopayHash } from '../lib/hash'

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
    await expect(autopayAdapterV1.capture({ sessionId: 'x', credentials })).rejects.toThrow(/capture/i)
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

  it('reports captured for a single SUCCESS transaction', async () => {
    const xml = statusResponseXml([
      { orderID: '100', remoteID: 'r1', amount: '1.50', currency: 'PLN', paymentDate: '20260910120000', paymentStatus: 'SUCCESS', paymentStatusDetails: 'AUTHORIZED' },
    ])
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(xml, { status: 200 }))

    const status = await autopayAdapterV1.getStatus({ sessionId: '100', credentials })
    expect(status.status).toBe('captured')
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
    const xml = '<?xml version="1.0"?><transaction><serviceID>2</serviceID><messageID>m1</messageID><confirmation>CONFIRMED</confirmation><reason>CANCELED_FULLY</reason><hash>irrelevant-for-this-test</hash></transaction>'
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(xml, { status: 200 }))

    const result = await autopayAdapterV1.cancel({ sessionId: '100', credentials })
    expect(result.status).toBe('cancelled')
  })

  it('fails closed when Autopay refuses to cancel (e.g. already settled)', async () => {
    const xml = '<?xml version="1.0"?><transaction><confirmation>NOTCONFIRMED</confirmation><reason>ALREADY_SETTLED</reason></transaction>'
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(xml, { status: 200 }))

    await expect(autopayAdapterV1.cancel({ sessionId: '100', credentials })).rejects.toThrow(/already be settled/)
  })
})

describe('autopayAdapterV1.refund', () => {
  afterEach(() => jest.restoreAllMocks())

  it('returns a pending status from the synchronous acknowledgment, never "refunded"', async () => {
    const messageId = 'abc123'
    const expectedHash = computeAutopayHash(['2', messageId], '2test2')
    const xml = `<?xml version="1.0"?><transactionRefund><serviceID>2</serviceID><messageID>${messageId}</messageID><hash>${expectedHash}</hash></transactionRefund>`
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(xml, { status: 200 }))

    const result = await autopayAdapterV1.refund({
      sessionId: '100',
      amount: 1.5,
      credentials,
      metadata: { remoteId: 'r1' },
    })

    expect(result.status).toBe('pending')
    expect(result.refundId).toBe(messageId)
  })

  it('requires metadata.remoteId — the OrderID alone is not enough for a refund', async () => {
    await expect(autopayAdapterV1.refund({ sessionId: '100', credentials }))
      .rejects.toThrow(/remoteId/)
  })
})
