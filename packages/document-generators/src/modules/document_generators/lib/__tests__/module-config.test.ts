import { DEFAULT_DOCUMENT_GENERATORS_CONFIG, findProviderConfig, resolveDocumentGeneratorsConfig } from '../module-config'

const containerWith = (value: unknown) => ({ resolve: (name: string) => {
  if (name !== 'documentGeneratorsConfig') throw new Error(`unknown ${name}`)
  return value
} })

describe('resolveDocumentGeneratorsConfig', () => {
  it('returns the module defaults when nothing is registered', () => {
    expect(resolveDocumentGeneratorsConfig({ resolve: () => { throw new Error('missing') } })).toEqual(DEFAULT_DOCUMENT_GENERATORS_CONFIG)
    expect(resolveDocumentGeneratorsConfig(containerWith(undefined))).toEqual({ providers: [] })
    expect(resolveDocumentGeneratorsConfig(containerWith({}))).toEqual({ providers: [] })
  })

  it('keeps the provider entries and leaves their config to the provider', () => {
    const providers = [
      { id: 'react-pdf', config: { fonts: 'not validated here' } },
      { id: 'docx' },
    ]
    expect(resolveDocumentGeneratorsConfig(containerWith({ providers }))).toEqual({ providers })
  })

  it.each([
    ['an unknown key', { fonts: [] }, 'fonts'],
    ['a provider without an id', { providers: [{ config: {} }] }, 'providers.0.id'],
    ['a duplicate provider id', { providers: [{ id: 'react-pdf' }, { id: 'react-pdf', config: {} }] }, 'duplicate provider id "react-pdf"'],
  ])('throws a descriptive error for %s', (_label, value, detail) => {
    expect(() => resolveDocumentGeneratorsConfig(containerWith(value))).toThrow('Invalid documentGeneratorsConfig')
    expect(() => resolveDocumentGeneratorsConfig(containerWith(value))).toThrow(detail)
  })

  it('validates one configuration object once and reuses the result', () => {
    const container = containerWith({ providers: [{ id: 'react-pdf' }] })
    expect(resolveDocumentGeneratorsConfig(container).providers).toBe(resolveDocumentGeneratorsConfig(container).providers)
  })
})

describe('findProviderConfig', () => {
  const config = { providers: [{ id: 'react-pdf', config: { fontFamily: 'Times-Roman' } }, { id: 'docx' }] }

  it('returns the config of the provider with that id', () => {
    expect(findProviderConfig(config, 'react-pdf')).toEqual({ fontFamily: 'Times-Roman' })
  })

  it('returns an empty config for a listed provider without one and nothing for an unlisted provider', () => {
    expect(findProviderConfig(config, 'docx')).toEqual({})
    expect(findProviderConfig(config, 'html-pdf')).toBeUndefined()
  })
})
