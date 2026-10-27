import type { Editor } from '@tiptap/core'
import {
  buildRecordFieldSnapshotContent,
  insertRecordFieldSnapshot,
  normalizeRecordFieldSnapshots,
} from '../lib/recordFieldInsertion'

const HIDDEN_ID = '11111111-1111-4111-8111-111111111111'

describe('record field snapshot insertion', () => {
  it('builds one selected field as native paragraph JSON', () => {
    expect(buildRecordFieldSnapshotContent([
      { field: 'name', label: 'Name', value: 'Acme' },
    ])).toEqual([{
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Name', marks: [{ type: 'bold' }] },
        { type: 'text', text: ': Acme' },
      ],
    }])
  })

  it('builds multiple explicitly selected fields as a two-column table', () => {
    const content = buildRecordFieldSnapshotContent([
      { field: 'name', label: 'Name', value: 'Acme' },
      { field: 'email', label: 'Email', value: 'hello@example.test' },
    ])

    expect(content[0]).toMatchObject({
      type: 'table',
      content: [
        { type: 'tableRow', content: expect.any(Array) },
        { type: 'tableRow', content: expect.any(Array) },
      ],
    })
    expect(content[1]).toEqual({ type: 'paragraph' })
    expect(JSON.stringify(content)).toContain('hello@example.test')
    expect(JSON.stringify(content)).not.toContain('<table')
  })

  it('drops empty, duplicate, and identifier-shaped labels or values', () => {
    expect(normalizeRecordFieldSnapshots([
      { field: 'name', label: 'Name', value: 'Acme' },
      { field: 'name', label: 'Name', value: 'Duplicate' },
      { field: 'empty', label: 'Empty', value: ' ' },
      { field: 'secret', label: 'Secret', value: `Internal ${HIDDEN_ID}` },
    ])).toEqual([{ field: 'name', label: 'Name', value: 'Acme' }])
  })

  it('inserts through the editor chain only while the editor is editable', () => {
    const chain = {
      focus: jest.fn(),
      insertContent: jest.fn(),
      run: jest.fn(() => true),
    }
    chain.focus.mockReturnValue(chain)
    chain.insertContent.mockReturnValue(chain)
    const editor = {
      isDestroyed: false,
      isEditable: true,
      chain: jest.fn(() => chain),
    } as unknown as Editor

    expect(insertRecordFieldSnapshot(editor, [
      { field: 'name', label: 'Name', value: 'Acme' },
    ])).toBe(true)
    expect(chain.insertContent).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ type: 'paragraph' }),
    ]))

    Object.defineProperty(editor, 'isEditable', { configurable: true, value: false })
    expect(insertRecordFieldSnapshot(editor, [
      { field: 'name', label: 'Name', value: 'Acme' },
    ])).toBe(false)
    expect(editor.chain).toHaveBeenCalledTimes(1)
  })
})
