import { parseInspectArgv, resolveSurfaceFilter } from '../args'

describe('parseInspectArgv', () => {
  it('defaults to tier 2 and non-json output', () => {
    const options = parseInspectArgv([])
    expect(options.json).toBe(false)
    expect(options.tier).toBe(2)
    expect(options.positionalSurface).toBeUndefined()
  })

  it('parses json, tier, tenant, org, and surface flags', () => {
    const options = parseInspectArgv([
      'event',
      '--json',
      '--tier',
      '3',
      '--tenant',
      'tenant-1',
      '--org',
      'org-1',
      '--surface',
      'event,subscriber',
    ])
    expect(options.json).toBe(true)
    expect(options.tier).toBe(3)
    expect(options.tenantId).toBe('tenant-1')
    expect(options.organizationId).toBe('org-1')
    expect(options.positionalSurface).toBe('event')
    expect(options.surfaceIds).toEqual(['event', 'subscriber'])
  })

  it('prefers explicit --surface over positional surface', () => {
    const options = parseInspectArgv(['event', '--surface', 'module'])
    expect(resolveSurfaceFilter(options)).toEqual(['module'])
  })
})
