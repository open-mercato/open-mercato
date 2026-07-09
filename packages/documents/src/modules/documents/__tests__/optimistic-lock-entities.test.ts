import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const editableEntities = [
  'Document',
  'DocumentContent',
  'DocumentFolder',
  'DocumentShare',
  'DocumentComment',
  'DocumentTemplate',
] as const

const appendOnlyEntities = [
  'DocumentVersion',
  'DocumentAttachment',
] as const

function readEntitySource(): string {
  return readFileSync(join(__dirname, '..', 'data', 'entities.ts'), 'utf8')
}

function classBlock(source: string, className: string): string | null {
  const match = new RegExp(`export class ${className}\\b`).exec(source)
  if (!match) return null
  const rest = source.slice(match.index + match[0].length)
  const nextIdx = rest.search(/\nexport (class|type|const|function|interface) /)
  return nextIdx >= 0 ? rest.slice(0, nextIdx) : rest
}

describe('documents optimistic locking entity coverage', () => {
  const source = readEntitySource()

  for (const className of editableEntities) {
    it(`${className} declares an updated_at column`, () => {
      const block = classBlock(source, className)
      expect(block).not.toBeNull()
      expect(block as string).toMatch(/@Property\(\{\s*name:\s*['"]updated_at['"]/)
    })
  }

  it('keeps append-only entities intentionally excluded from editable coverage', () => {
    expect(editableEntities).not.toContain('DocumentVersion')
    expect(editableEntities).not.toContain('DocumentAttachment')
    expect(appendOnlyEntities).toEqual(['DocumentVersion', 'DocumentAttachment'])
  })

  for (const className of appendOnlyEntities) {
    it(`${className} remains append-only without updated_at`, () => {
      const block = classBlock(source, className)
      expect(block).not.toBeNull()
      expect(block as string).not.toMatch(/@Property\(\{\s*name:\s*['"]updated_at['"]/)
    })
  }
})
