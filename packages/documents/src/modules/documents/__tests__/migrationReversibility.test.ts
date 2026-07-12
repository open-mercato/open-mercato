import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('documents migration reversibility', () => {
  it('drops the initial schema in reverse dependency order', () => {
    const source = readFileSync(join(
      __dirname,
      '..',
      'migrations',
      'Migration20260708163836_documents.ts',
    ), 'utf8')
    const expectedOrder = [
      'document_versions',
      'document_shares',
      'document_folders',
      'document_contents',
      'document_comments',
      'document_attachments',
      'documents',
    ]
    const down = source.slice(source.indexOf('override down()'))

    expect(down).not.toBe(source)
    for (const table of expectedOrder) {
      expect(down).toContain(`drop table if exists "${table}" cascade`)
    }
    for (let index = 1; index < expectedOrder.length; index += 1) {
      expect(down.indexOf(`"${expectedOrder[index - 1]}"`))
        .toBeLessThan(down.indexOf(`"${expectedOrder[index]}"`))
    }
  })
})
