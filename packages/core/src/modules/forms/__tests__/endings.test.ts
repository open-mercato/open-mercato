import {
  addLayoutFromPalette,
  setRedirectUrl,
  SchemaHelperError,
  type FormSchema,
} from '../backend/forms/[id]/studio/schema-helpers'
import { listLayoutCatalogEntries } from '../schema/layout-catalog'
import { resolvePaletteId } from '../backend/forms/[id]/studio/palette/entries'

describe('Endings — palette + canvas + properties', () => {
  it('layout catalog lists the Ending screen entry', () => {
    const entries = listLayoutCatalogEntries()
    const ending = entries.find((entry) => entry.kind === 'ending')
    expect(ending).toBeDefined()
    expect(ending?.id).toBe('ending')
  })

  it('resolvePaletteId decodes the ending primitive', () => {
    expect(resolvePaletteId('layout:ending')).toEqual({ kind: 'layout-primitive', layoutKind: 'ending' })
  })

  it('addLayoutFromPalette creates an ending section', () => {
    const schema: FormSchema = { type: 'object', properties: {} }
    const result = addLayoutFromPalette({ schema, kind: 'ending' })
    const sections = (result.schema['x-om-sections'] ?? []) as Array<{ key: string; kind?: string; title?: Record<string, string> }>
    expect(sections).toHaveLength(1)
    expect(sections[0].kind).toBe('ending')
    expect(sections[0].title?.en).toBe('New ending')
  })

  it('setRedirectUrl writes the URL on an ending and clears on empty', () => {
    const schema: FormSchema = { type: 'object', properties: {} }
    const withEnding = addLayoutFromPalette({ schema, kind: 'ending' }).schema
    const sectionKey = (withEnding['x-om-sections'] as Array<{ key: string }>)[0].key
    const withUrl = setRedirectUrl({ schema: withEnding, sectionKey, url: 'https://example.com/thanks' })
    const section = (withUrl['x-om-sections'] as Array<Record<string, unknown>>)[0]
    expect(section['x-om-redirect-url']).toBe('https://example.com/thanks')
    const cleared = setRedirectUrl({ schema: withUrl, sectionKey, url: '' })
    const clearedSection = (cleared['x-om-sections'] as Array<Record<string, unknown>>)[0]
    expect(clearedSection['x-om-redirect-url']).toBeUndefined()
  })

  it('setRedirectUrl rejects non-ending sections', () => {
    const schema: FormSchema = { type: 'object', properties: {} }
    const withPage = addLayoutFromPalette({ schema, kind: 'page' }).schema
    const sectionKey = (withPage['x-om-sections'] as Array<{ key: string }>)[0].key
    expect(() => setRedirectUrl({ schema: withPage, sectionKey, url: 'https://x.com' })).toThrow(SchemaHelperError)
  })
})
