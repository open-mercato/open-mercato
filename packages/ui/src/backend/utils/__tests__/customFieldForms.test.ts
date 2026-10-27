import { buildFormFieldFromCustomFieldDef } from '../customFieldForms'

/**
 * Guards issue #4371: `kind: 'multiline'` definitions must be able to render
 * a plain <textarea> via `editor: 'plain'` instead of always mapping to the
 * rich-text editor.
 */
describe('buildFormFieldFromCustomFieldDef multiline mapping', () => {
  it('maps multiline without an editor hint to the html rich-text editor', () => {
    const field = buildFormFieldFromCustomFieldDef({ key: 'notes', kind: 'multiline' })
    expect(field).toMatchObject({ type: 'richtext', editor: 'html' })
  })

  it('maps editor simpleMarkdown to the simple rich-text editor', () => {
    const field = buildFormFieldFromCustomFieldDef({ key: 'notes', kind: 'multiline', editor: 'simpleMarkdown' })
    expect(field).toMatchObject({ type: 'richtext', editor: 'simple' })
  })

  it('maps editor plain to a plain textarea', () => {
    const field = buildFormFieldFromCustomFieldDef({ key: 'notes', kind: 'multiline', editor: 'plain' })
    expect(field).toMatchObject({ id: 'cf_notes', type: 'textarea' })
    expect(field).not.toHaveProperty('editor')
  })

  it('maps text kind with editor plain to a plain textarea as well', () => {
    const field = buildFormFieldFromCustomFieldDef({ key: 'summary', kind: 'text', editor: 'plain' })
    expect(field).toMatchObject({ id: 'cf_summary', type: 'textarea' })
  })
})
