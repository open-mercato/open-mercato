import { autopayHealthCheck } from '../lib/health'
import { computeAutopayHash } from '../lib/hash'

const credentials = {
  serviceId: '2',
  sharedKey: '2test2',
  gatewayUrl: 'https://testpay.autopay.eu/sciezka',
}

describe('autopayHealthCheck', () => {
  afterEach(() => jest.restoreAllMocks())

  it('reports healthy for a zero-transaction response with no reason', async () => {
    const hash = computeAutopayHash(['2'], '2test2')
    const xml = `<?xml version="1.0"?><transactionList><serviceID>2</serviceID><transactions></transactions><hash>${hash}</hash></transactionList>`
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(xml, { status: 200 }))

    const result = await autopayHealthCheck.check(credentials)
    expect(result.status).toBe('healthy')
  })

  it('reports healthy for a zero-transaction response that carries a reason (e.g. "not found")', async () => {
    const hash = computeAutopayHash(['2'], '2test2')
    const xml = `<?xml version="1.0"?><transactionList><serviceID>2</serviceID><transactions></transactions><reason>NOT_FOUND</reason><hash>${hash}</hash></transactionList>`
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(xml, { status: 200 }))

    const result = await autopayHealthCheck.check(credentials)
    expect(result.status).toBe('healthy')
  })

  it('reports unhealthy when the response fails hash verification', async () => {
    const xml = '<?xml version="1.0"?><transactionList><serviceID>2</serviceID><transactions>'
      + '<transaction><orderID>x</orderID><remoteID>r</remoteID><amount>1.00</amount><currency>PLN</currency>'
      + '<gatewayID></gatewayID><paymentDate>20260101000000</paymentDate><paymentStatus>SUCCESS</paymentStatus>'
      + '<paymentStatusDetails></paymentStatusDetails></transaction>'
      + '</transactions><hash>not-a-real-hash</hash></transactionList>'
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(xml, { status: 200 }))

    const result = await autopayHealthCheck.check(credentials)
    expect(result.status).toBe('unhealthy')
  })

  it('reports unhealthy when credentials are incomplete', async () => {
    const result = await autopayHealthCheck.check({ serviceId: '2' })
    expect(result.status).toBe('unhealthy')
    expect(result.message).toMatch(/sharedKey/)
  })

  it('reports unhealthy for an unrecognized gateway host', async () => {
    const result = await autopayHealthCheck.check({
      serviceId: '2',
      sharedKey: '2test2',
      gatewayUrl: 'https://not-autopay.example.com/x',
    })
    expect(result.status).toBe('unhealthy')
  })
})
