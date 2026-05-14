/** @jest-environment node */

import { platformDomains } from '../platformDomains'

describe('platformDomains', () => {
  const originalValue = process.env.PLATFORM_DOMAINS

  afterEach(() => {
    if (originalValue === undefined) delete process.env.PLATFORM_DOMAINS
    else process.env.PLATFORM_DOMAINS = originalValue
  })

  it('returns the documented default when PLATFORM_DOMAINS is unset', () => {
    delete process.env.PLATFORM_DOMAINS
    expect(platformDomains()).toEqual(['localhost', 'openmercato.com'])
  })

  it('lowercases, trims, and drops empty entries', () => {
    process.env.PLATFORM_DOMAINS = ' Foo.Example , ,bar.test , '
    expect(platformDomains()).toEqual(['foo.example', 'bar.test'])
  })

  it('returns an empty list when the env is set to an empty string (?? does not coerce empty strings)', () => {
    process.env.PLATFORM_DOMAINS = ''
    expect(platformDomains()).toEqual([])
  })

  it('treats only-whitespace and only-commas as empty after filtering', () => {
    process.env.PLATFORM_DOMAINS = ' , , '
    expect(platformDomains()).toEqual([])
  })
})
