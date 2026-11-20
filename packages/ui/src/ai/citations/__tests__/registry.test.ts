import {
  fallbackCitation,
  getCitationResolver,
  isExternalCitationHref,
  isSafeCitationHref,
  listCitationResolverKinds,
  registerCitationResolver,
  resetCitationResolversForTests,
  resolveCitation,
  unregisterCitationResolver,
} from '../registry'
import { mergeConsecutiveCitationParts, readCitationsPayload } from '../merge'
import {
  NON_STRING_CITATION_HREFS,
  SAFE_CITATION_HREFS,
  UNSAFE_CITATION_HREFS,
} from './href-safety-cases'

afterEach(() => {
  resetCitationResolversForTests()
})

describe('isSafeCitationHref', () => {
  it.each(SAFE_CITATION_HREFS)('accepts %p', (href) => {
    expect(isSafeCitationHref(href)).toBe(true)
  })

  it.each(UNSAFE_CITATION_HREFS)('rejects %p', (href) => {
    expect(isSafeCitationHref(href)).toBe(false)
  })

  it.each(NON_STRING_CITATION_HREFS)('rejects non-string %p', (href) => {
    expect(isSafeCitationHref(href)).toBe(false)
  })

  it('classifies same-origin paths as internal and absolute URLs as external', () => {
    expect(isExternalCitationHref('/backend/kb/1')).toBe(false)
    expect(isExternalCitationHref('https://example.com')).toBe(true)
  })
})

describe('citation resolver registry', () => {
  it('registers, lists and unregisters resolvers by kind', () => {
    const resolver = () => ({ title: 'KB' })
    registerCitationResolver('kb', resolver)
    expect(getCitationResolver('kb')).toBe(resolver)
    expect(listCitationResolverKinds()).toEqual(['kb'])
    unregisterCitationResolver('kb')
    expect(getCitationResolver('kb')).toBeNull()
  })

  it('shares one store through globalThis', () => {
    registerCitationResolver('kb', () => ({ title: 'KB' }))
    const store = (globalThis as Record<string, unknown>).__openMercatoAiCitationResolvers
    expect(store).toBeInstanceOf(Map)
    expect((store as Map<string, unknown>).has('kb')).toBe(true)
  })

  it('lets the last registration win', async () => {
    registerCitationResolver('kb', () => ({ title: 'First' }))
    registerCitationResolver('kb', () => ({ title: 'Second' }))
    await expect(resolveCitation({ kind: 'kb', ref: 'a' })).resolves.toEqual({ title: 'Second' })
  })

  it('rejects an empty kind', () => {
    expect(() => registerCitationResolver('', () => null)).toThrow()
  })

  it('falls back to label, then ref, for unknown kinds', async () => {
    await expect(resolveCitation({ kind: 'unknown', ref: 'doc-1', label: 'Doc one' })).resolves.toEqual({
      title: 'Doc one',
    })
    await expect(resolveCitation({ kind: 'unknown', ref: 'doc-1' })).resolves.toEqual({ title: 'doc-1' })
  })

  it('keeps only safe hrefs in the fallback', () => {
    expect(fallbackCitation({ kind: 'x', ref: 'r', href: '/backend/x' })).toEqual({ title: 'r', href: '/backend/x' })
    expect(fallbackCitation({ kind: 'x', ref: 'r', href: 'javascript:alert(1)' })).toEqual({ title: 'r' })
  })

  it('falls back when the resolver throws, rejects or returns null', async () => {
    registerCitationResolver('throws', () => {
      throw new Error('boom')
    })
    registerCitationResolver('rejects', () => Promise.reject(new Error('boom')))
    registerCitationResolver('empty', () => null)
    for (const kind of ['throws', 'rejects', 'empty']) {
      await expect(resolveCitation({ kind, ref: 'r', label: 'Label', href: '/x' })).resolves.toEqual({
        title: 'Label',
        href: '/x',
      })
    }
  })

  it('drops an unsafe href returned by a resolver and keeps valid steps', async () => {
    registerCitationResolver('kb', async () => ({
      title: 'Resolved',
      href: 'javascript:alert(1)',
      steps: [{ id: 'S1', text: 'Step one' }],
    }))
    await expect(resolveCitation({ kind: 'kb', ref: 'r', href: '/fallback' })).resolves.toEqual({
      title: 'Resolved',
      steps: [{ id: 'S1', text: 'Step one' }],
    })
  })

  it('passes the full citation to the resolver and keeps the citation href when the resolver omits one', async () => {
    const resolver = jest.fn(() => ({ title: 'Resolved' }))
    registerCitationResolver('kb', resolver)
    const citation = { kind: 'kb', ref: 'refund@4', version: '4', locator: '§3', href: '/kb/refund' }
    await expect(resolveCitation(citation)).resolves.toEqual({ title: 'Resolved', href: '/kb/refund' })
    expect(resolver).toHaveBeenCalledWith(citation)
  })
})

describe('mergeConsecutiveCitationParts', () => {
  const citationsPart = (key: string, refs: string[], title?: string) => ({
    key,
    componentId: 'ai_assistant:citations',
    payload: { citations: refs.map((ref) => ({ kind: 'kb', ref })), ...(title ? { title } : {}) },
  })

  it('merges consecutive citations parts into one, deduped, keeping the first title', () => {
    const merged = mergeConsecutiveCitationParts([
      citationsPart('a', ['one', 'two'], 'First'),
      citationsPart('b', ['two', 'three'], 'Second'),
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].key).toBe('a')
    expect(merged[0].payload).toEqual({
      citations: [
        { kind: 'kb', ref: 'one' },
        { kind: 'kb', ref: 'two' },
        { kind: 'kb', ref: 'three' },
      ],
      title: 'First',
    })
  })

  it('does not merge citations parts separated by another part', () => {
    const other = { key: 'x', componentId: 'mutation-result-card', payload: {} }
    const merged = mergeConsecutiveCitationParts([
      citationsPart('a', ['one']),
      other,
      citationsPart('b', ['two']),
    ])
    expect(merged.map((part) => part.key)).toEqual(['a', 'x', 'b'])
  })

  it('reads payloads defensively', () => {
    expect(readCitationsPayload(null)).toEqual({ citations: [] })
    expect(
      readCitationsPayload({ citations: [{ kind: 'kb' }, 'bad', { kind: 'kb', ref: 'r', steps: ['S1', 2] }] }),
    ).toEqual({ citations: [{ kind: 'kb', ref: 'r', steps: ['S1'] }] })
  })
})
