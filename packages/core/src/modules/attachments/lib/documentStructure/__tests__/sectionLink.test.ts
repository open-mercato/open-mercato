import { buildDocumentSectionHref, DOCUMENT_SECTION_PAGE_BASE_PATH } from '../sectionLink'

describe('buildDocumentSectionHref', () => {
  it('builds a relative in-app link to one section of one attachment', () => {
    expect(
      buildDocumentSectionHref('11111111-1111-4111-8111-111111111111', '0123456789abcdef0123456789abcdef'),
    ).toBe(`${DOCUMENT_SECTION_PAGE_BASE_PATH}/11111111-1111-4111-8111-111111111111/sections/0123456789abcdef0123456789abcdef`)
  })

  it('encodes path segments so a crafted value cannot change the route', () => {
    const href = buildDocumentSectionHref('../../x?y=1', 'a/b#c')
    expect(href).toBe(`${DOCUMENT_SECTION_PAGE_BASE_PATH}/..%2F..%2Fx%3Fy%3D1/sections/a%2Fb%23c`)
    expect(href.startsWith('/backend/storage/attachments/')).toBe(true)
  })
})
