import { GET, metadata } from '../version/route'

describe('api_docs /api/version route', () => {
  it('is served at /api/version without auth', () => {
    expect(metadata.path).toBe('/version')
    expect(metadata.GET.requireAuth).toBe(false)
  })

  it('returns the deployed version', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.version).toBe('string')
    expect(body.version.length).toBeGreaterThan(0)
    expect(Object.keys(body)).toEqual(['version'])
  })

  it('prefers an explicit OM_VERSION / OPEN_MERCATO_VERSION override', async () => {
    const originalOm = process.env.OM_VERSION
    process.env.OM_VERSION = '9.9.9-test'
    try {
      let body: { version: string } | undefined
      await jest.isolateModulesAsync(async () => {
        const mod = await import('../version/route')
        const res = await mod.GET()
        body = await res.json()
      })
      expect(body?.version).toBe('9.9.9-test')
    } finally {
      if (originalOm === undefined) delete process.env.OM_VERSION
      else process.env.OM_VERSION = originalOm
    }
  })
})
