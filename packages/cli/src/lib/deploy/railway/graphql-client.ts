import {
  collectSensitiveStructuredValues,
  redactStructuredValue,
  redactText,
} from './redaction'
import type { RailwayGraphqlClient, RailwayGraphqlOperation } from './types'

type FetchLike = typeof fetch

type GraphqlResponse<T> = {
  data?: T
  errors?: Array<{
    message?: string
    extensions?: { code?: string }
  }>
}

export class RailwayGraphqlError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
  ) {
    super(message)
    this.name = 'RailwayGraphqlError'
  }
}

function shouldRetry(error: unknown): boolean {
  return (
    error instanceof RailwayGraphqlError &&
    ((error.status !== undefined && error.status >= 500) || error.code === 'INTERNAL_ERROR')
  )
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function createRailwayGraphqlClient(input: {
  token: string
  verbose?: boolean
  endpoint?: string
  fetchImpl?: FetchLike
  logger?: Pick<Console, 'log'>
}): RailwayGraphqlClient {
  const endpoint = input.endpoint ?? 'https://backboard.railway.com/graphql/v2'
  if (!endpoint.startsWith('https://')) {
    throw new Error('Railway GraphQL endpoint must use HTTPS.')
  }
  const fetchImpl = input.fetchImpl ?? fetch
  const logger = input.logger ?? console

  async function execute<T>(
    operation: RailwayGraphqlOperation,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const requestSecrets = [input.token, ...collectSensitiveStructuredValues(variables)]
    if (input.verbose) {
      logger.log(
        `[railway:gql] ${operation.name} ${JSON.stringify(redactStructuredValue(variables, requestSecrets))}`,
      )
    }
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operationName: operation.name,
        query: operation.query,
        variables,
      }),
      signal: AbortSignal.timeout(operation.mutation ? 30_000 : 10_000),
    })
    const bodyText = await response.text()
    let body: GraphqlResponse<T>
    try {
      body = JSON.parse(bodyText) as GraphqlResponse<T>
    } catch {
      throw new RailwayGraphqlError(
        `Railway returned a non-JSON response (${response.status}).`,
        response.status,
      )
    }
    const firstError = body.errors?.[0]
    if (!response.ok || firstError) {
      throw new RailwayGraphqlError(
        redactText(
          firstError?.message || `Railway request failed (${response.status}).`,
          requestSecrets,
        ),
        response.status,
        firstError?.extensions?.code,
      )
    }
    if (body.data === undefined) {
      throw new RailwayGraphqlError('Railway response did not include data.', response.status)
    }
    if (input.verbose) {
      logger.log(
        `[railway:gql] ${operation.name} response ${JSON.stringify(redactStructuredValue(body.data, requestSecrets))}`,
      )
    }
    return body.data
  }

  return {
    async request<T>(
      operation: RailwayGraphqlOperation,
      variables: Record<string, unknown> = {},
    ): Promise<T> {
      const attempts = operation.mutation ? 1 : 2
      let lastError: unknown
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          return await execute<T>(operation, variables)
        } catch (error) {
          lastError = error
          if (attempt + 1 >= attempts || !shouldRetry(error)) throw error
          await wait(250 * (2 ** attempt))
        }
      }
      throw lastError
    },
  }
}
