import { channelSesHealthCheck } from '../health'

var sendMock: jest.Mock
var destroyMock: jest.Mock
var SESv2ClientMock: jest.Mock
var GetAccountCommandMock: jest.Mock

jest.mock('@aws-sdk/client-sesv2', () => {
  sendMock = jest.fn().mockResolvedValue({ ProductionAccessEnabled: true, SendingEnabled: true })
  destroyMock = jest.fn()
  SESv2ClientMock = jest.fn().mockImplementation(() => ({ send: sendMock, destroy: destroyMock }))
  GetAccountCommandMock = jest.fn()
  return { SESv2Client: SESv2ClientMock, GetAccountCommand: GetAccountCommandMock }
})

describe('channelSesHealthCheck', () => {
  beforeEach(() => {
    sendMock.mockClear()
    destroyMock.mockClear()
    SESv2ClientMock.mockClear()
    GetAccountCommandMock.mockClear()
  })

  it('performs a bounded GetAccount probe and closes the client', async () => {
    const result = await channelSesHealthCheck.check(
      { region: 'eu-west-2', fromAddress: 'from@example.com' },
      { tenantId: 'tenant-1', organizationId: 'organization-1' },
    )

    expect(result).toEqual(expect.objectContaining({ status: 'healthy' }))
    expect(SESv2ClientMock).toHaveBeenCalledWith({ region: 'eu-west-2' })
    expect(sendMock).toHaveBeenCalledWith(expect.anything(), {
      abortSignal: expect.any(AbortSignal),
    })
    expect(destroyMock).toHaveBeenCalledTimes(1)
  })

  it('reports provider failures as unhealthy', async () => {
    sendMock.mockRejectedValueOnce(new Error('access denied'))

    const result = await channelSesHealthCheck.check(
      { region: 'eu-west-2', fromAddress: 'from@example.com' },
      { tenantId: 'tenant-1', organizationId: 'organization-1' },
    )

    expect(result).toEqual(expect.objectContaining({
      status: 'unhealthy',
      message: expect.stringContaining('access denied'),
    }))
  })
})
