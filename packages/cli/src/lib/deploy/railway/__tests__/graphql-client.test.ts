import {
  createRailwayGraphqlClient,
  RailwayGraphqlError,
} from '../graphql-client'

const query = { name: 'TestQuery', query: 'query TestQuery { me { id } }' }
const mutation = { ...query, name: 'TestMutation', mutation: true }

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('Railway GraphQL client', () => {
  it('sends operationName, query, variables, and bearer auth', async () => {
    const fetchImpl = jest.fn(async () => response({ data: { me: { id: 'user' } } }))
    const client = createRailwayGraphqlClient({
      token: 'account-token',
      fetchImpl: fetchImpl as typeof fetch,
    })

    await expect(client.request(query, { input: 'value' })).resolves.toEqual({ me: { id: 'user' } })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://backboard.railway.com/graphql/v2',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer account-token' }),
        body: JSON.stringify({
          operationName: 'TestQuery',
          query: query.query,
          variables: { input: 'value' },
        }),
      }),
    )
  })

  it('retries idempotent reads once on a server error', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({ errors: [{ message: 'temporary' }] }, 500))
      .mockResolvedValueOnce(response({ data: { ok: true } }))
    const client = createRailwayGraphqlClient({
      token: 'token',
      fetchImpl: fetchImpl as typeof fetch,
    })
    await expect(client.request(query)).resolves.toEqual({ ok: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('never blindly retries mutations', async () => {
    const fetchImpl = jest.fn(async () => response({ errors: [{ message: 'ambiguous' }] }, 500))
    const client = createRailwayGraphqlClient({
      token: 'token',
      fetchImpl: fetchImpl as typeof fetch,
    })
    await expect(client.request(mutation)).rejects.toBeInstanceOf(RailwayGraphqlError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('redacts sensitive request and response fields in verbose logs', async () => {
    const logger = { log: jest.fn() }
    const fetchImpl = jest.fn(async () => response({
      data: { variables: { AUTH_SECRET: 'response-secret', SAFE_VALUE: 'visible' } },
    }))
    const client = createRailwayGraphqlClient({
      token: 'account-token',
      verbose: true,
      fetchImpl: fetchImpl as typeof fetch,
      logger,
    })

    await client.request(query, {
      input: { JWT_SECRET: 'request-secret', SAFE_VALUE: 'visible' },
    })

    const output = logger.log.mock.calls.flat().join('\n')
    expect(output).not.toContain('request-secret')
    expect(output).not.toContain('response-secret')
    expect(output).toContain('<redacted>')
    expect(output).toContain('visible')
  })
})
