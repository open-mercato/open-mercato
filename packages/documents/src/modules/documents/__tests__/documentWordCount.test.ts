import { Schema } from '@tiptap/pm/model'
import { countDocumentWordsAndCharacters } from '../backend/documents/[id]/useDocumentEditor'

describe('document word and character counts', () => {
  it('matches the existing CharacterCount semantics with one document traversal', () => {
    const schema = new Schema({
      nodes: {
        doc: { content: 'block+' },
        paragraph: { content: 'inline*', group: 'block' },
        horizontalRule: { group: 'block' },
        text: { group: 'inline' },
      },
    })
    const doc = schema.node('doc', undefined, [
      schema.node('paragraph', undefined, schema.text('First  paragraph')),
      schema.node('paragraph', undefined, schema.text('Second\tline')),
      schema.node('horizontalRule'),
      schema.node('paragraph', undefined, schema.text('Emoji 🧠')),
    ])
    const characterText = doc.textBetween(0, doc.content.size, undefined, ' ')
    const wordText = doc.textBetween(0, doc.content.size, ' ', ' ')

    expect(countDocumentWordsAndCharacters(doc)).toEqual({
      characters: characterText.length,
      words: wordText.split(' ').filter((word) => word !== '').length,
    })
  })
})
