import { metadata as privacyMeta } from '../modules/content/frontend/privacy/page.meta'
import { metadata as termsMeta } from '../modules/content/frontend/terms/page.meta'

describe('privacy page metadata', () => {
  it('has a title', () => {
    expect(privacyMeta.title).toBe('Privacy Policy')
  })

  it('has a description', () => {
    expect(typeof privacyMeta.description).toBe('string')
    expect(privacyMeta.description!.length).toBeGreaterThan(0)
  })
})

describe('terms page metadata', () => {
  it('has a title', () => {
    expect(termsMeta.title).toBe('Terms of Service')
  })

  it('has a description', () => {
    expect(typeof termsMeta.description).toBe('string')
    expect(termsMeta.description!.length).toBeGreaterThan(0)
  })
})
