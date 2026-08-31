/** @jest-environment node */
// Reporting a broken runtime configuration is the whole job of this endpoint, so an
// unusable OM_BUSINESS_HARNESS_TRANSPORT must come back as `degraded` rather than as
// an unhandled 500 that tells the operator nothing.
import { GET } from '../api/runtime/health/route'

const TRANSPORT = 'OM_BUSINESS_HARNESS_TRANSPORT'
const previous = process.env[TRANSPORT]

afterEach(() => {
  if (previous === undefined) delete process.env[TRANSPORT]
  else process.env[TRANSPORT] = previous
})

describe('business harness runtime health', () => {
  it('reports an unsupported transport instead of throwing', async () => {
    process.env[TRANSPORT] = 'socket'
    const response = await GET()

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('degraded')
    expect(body.harness.healthy).toBe(false)
    expect(body.capability.healthy).toBe(false)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('reports the one-off mode when the transport is left unset', async () => {
    delete process.env[TRANSPORT]
    const body = await (await GET()).json()
    expect(body.harness.mode).toBe('one-off')
  })
})
