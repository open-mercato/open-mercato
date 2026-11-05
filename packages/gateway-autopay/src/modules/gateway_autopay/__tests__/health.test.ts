import {
  registerTelemetryRuntime,
  resetTelemetryRuntime,
  type TelemetryRuntime,
} from '@open-mercato/shared/lib/telemetry/runtime'
import { autopayHealthCheck } from '../lib/health'
import { computeAutopayHash } from '../lib/hash'

const credentials = {
  serviceId: '2',
  sharedKey: '2test2',
  gatewayUrl: 'https://testpay.autopay.eu/sciezka',
}

describe('autopayHealthCheck', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    resetTelemetryRuntime()
  })

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

  it('reports unhealthy for a zero-transaction response with an invalid hash — an empty list is not a free pass', async () => {
    const xml = '<?xml version="1.0"?><transactionList><serviceID>2</serviceID><transactions></transactions><hash>INVALID-HASH</hash></transactionList>'
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(xml, { status: 200 }))

    const result = await autopayHealthCheck.check(credentials)
    expect(result.status).toBe('unhealthy')
  })

  it('reports unhealthy for a zero-transaction response signed with the wrong shared key', async () => {
    const wrongKeyHash = computeAutopayHash(['2'], 'not-the-real-shared-key')
    const xml = `<?xml version="1.0"?><transactionList><serviceID>2</serviceID><transactions></transactions><hash>${wrongKeyHash}</hash></transactionList>`
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(xml, { status: 200 }))

    const result = await autopayHealthCheck.check(credentials)
    expect(result.status).toBe('unhealthy')
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

  it('reports unhealthy with a localized message when credentials are incomplete', async () => {
    const result = await autopayHealthCheck.check({ serviceId: '2' })
    expect(result.status).toBe('unhealthy')
    expect(result.message).toBe('Autopay Shared Key is not configured.')
    expect(result.details).toMatchObject({ missingCredential: 'sharedKey' })
  })

  it('does not report an expected missing-credential state as an error', async () => {
    const reportError = jest.fn()
    registerTelemetryRuntime({ reportError } as unknown as TelemetryRuntime)

    await autopayHealthCheck.check({ serviceId: '2' })

    expect(reportError).not.toHaveBeenCalled()
  })

  it('reports a failed probe through telemetry with a stable code and keeps the raw diagnostic out of the message', async () => {
    const reportError = jest.fn()
    registerTelemetryRuntime({ reportError } as unknown as TelemetryRuntime)
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('socket hang up (testpay.autopay.eu)'))

    const result = await autopayHealthCheck.check(credentials)

    expect(result.status).toBe('unhealthy')
    expect(result.message).not.toContain('socket hang up')
    expect(result.details).toMatchObject({ error: expect.stringContaining('socket hang up') })
    expect(reportError).toHaveBeenCalledTimes(1)
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), {
      module: 'gateway_autopay',
      code: 'gateway_autopay.health_check_failed',
    })
  })

  it('still answers when the telemetry sink itself throws', async () => {
    registerTelemetryRuntime({
      reportError: () => { throw new Error('sink down') },
    } as unknown as TelemetryRuntime)
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'))

    const result = await autopayHealthCheck.check(credentials)

    expect(result.status).toBe('unhealthy')
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
