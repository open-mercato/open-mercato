// One scenario of request-cost.mjs: warm up, reset the statement counters, send N requests and
// summarize them. Any response other than 2xx aborts the scenario: an expired token, wrong-tenant
// credentials or a server error would otherwise be measured as a (cheaper) normal request.
import { summarizeLatencies, summarizeStatements } from './stats.mjs'

export class UnexpectedStatusError extends Error {
  constructor({ scenario, phase, status, requestPath }) {
    super(`${scenario}: HTTP ${status} during ${phase} on ${requestPath}`)
    this.name = 'UnexpectedStatusError'
    Object.assign(this, { scenario, phase, status, requestPath })
  }
}

const isSuccess = (status) => status >= 200 && status < 300

/**
 * @param {object} options
 * @param {string} options.scenario name, used in errors
 * @param {() => string} options.nextPath request path generator
 * @param {(path: string) => Promise<{ status: number, ms: number, bytes: number }>} options.request
 * @param {number} options.warmup requests before the counters are reset
 * @param {number} options.n measured requests
 * @param {() => Promise<void>} options.resetStatements
 * @param {() => Promise<object[]>} options.readStatements
 */
export async function measureScenario({ scenario, nextPath, request, warmup, n, resetStatements, readStatements }) {
  const send = async (phase) => {
    const requestPath = nextPath()
    const response = await request(requestPath)
    if (!isSuccess(response.status)) throw new UnexpectedStatusError({ scenario, phase, status: response.status, requestPath })
    return { requestPath, response }
  }

  for (let i = 0; i < warmup; i++) await send('warmup')
  await resetStatements()
  const latencies = []
  const statuses = {}
  let bytes = 0
  let example = null
  for (let i = 0; i < n; i++) {
    const { requestPath, response } = await send('measurement')
    latencies.push(response.ms)
    statuses[response.status] = (statuses[response.status] ?? 0) + 1
    bytes += response.bytes
    if (i === 0) example = requestPath
  }
  const statements = await readStatements()
  return {
    example,
    statuses,
    latencyMs: summarizeLatencies(latencies),
    avgResponseBytes: Math.round(bytes / n),
    ...summarizeStatements(statements, n),
  }
}
