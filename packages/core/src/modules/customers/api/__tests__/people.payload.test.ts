import { normalizePersonPayload } from '../people/payload'

describe('customers people payload normalization', () => {
  it('lifts nested profile fields to top-level payload', () => {
    const normalized = normalizePersonPayload({
      firstName: 'Ada',
      lastName: 'Lovelace',
      profile: {
        linkedInUrl: 'https://linkedin.example.com/in/ada',
        timezone: 'America/Chicago',
      },
    })

    expect(normalized).toMatchObject({
      firstName: 'Ada',
      lastName: 'Lovelace',
      linkedInUrl: 'https://linkedin.example.com/in/ada',
      timezone: 'America/Chicago',
    })
    expect(normalized).not.toHaveProperty('profile')
  })

  it('keeps explicit top-level values when both shapes are provided', () => {
    const normalized = normalizePersonPayload({
      linkedInUrl: 'https://linkedin.example.com/in/top-level',
      profile: {
        linkedInUrl: 'https://linkedin.example.com/in/nested',
      },
    })

    expect(normalized.linkedInUrl).toBe('https://linkedin.example.com/in/top-level')
    expect(normalized).not.toHaveProperty('profile')
  })

  it('returns non-profile payloads unchanged', () => {
    const normalized = normalizePersonPayload({
      id: '7f8ee770-1f3e-41e2-b80d-a0fdbf527f66',
      linkedInUrl: 'https://linkedin.example.com/in/person',
    })

    expect(normalized).toEqual({
      id: '7f8ee770-1f3e-41e2-b80d-a0fdbf527f66',
      linkedInUrl: 'https://linkedin.example.com/in/person',
    })
  })
})
