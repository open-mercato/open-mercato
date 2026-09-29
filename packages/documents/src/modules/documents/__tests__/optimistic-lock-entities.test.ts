import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const editableEntities = [
  'Document',
  'DocumentContent',
  'DocumentFolder',
  'DocumentShare',
  'DocumentComment',
  'DocumentTemplate',
  'DocumentEntityLink',
  'DocumentAttachment',
] as const

const appendOnlyEntities = [
  'DocumentVersion',
] as const

/**
 * Pure per-user toggle rows: they carry no editable fields (existence *is* the
 * state), each row belongs to exactly one user, and every mutation is
 * serialized by a pessimistic write lock on the parent document aggregate.
 * That is two of the exemption classes the platform guard documents verbatim —
 * "pure junction / assignment tables (add-remove, not field-edited)" and
 * sub-resource rows "guarded by their parent document's aggregate version".
 * See packages/core/src/__tests__/optimistic-lock-editable-entities.test.ts.
 *
 * The parent-aggregate lock is what justifies the exemption, so it is asserted
 * below rather than left as a comment: drop the lock and this fails.
 */
const parentGuardedToggleEntities = [
  { className: 'DocumentFavorite', commandModule: 'favorites.ts' },
  { className: 'DocumentWatcher', commandModule: 'watchers.ts' },
] as const

function readEntitySource(): string {
  return readFileSync(join(__dirname, '..', 'data', 'entities.ts'), 'utf8')
}

function readCommandSource(moduleFile: string): string {
  return readFileSync(join(__dirname, '..', 'commands', moduleFile), 'utf8')
}

function countOccurrences(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0
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
    expect(appendOnlyEntities).toEqual(['DocumentVersion'])
  })

  for (const className of appendOnlyEntities) {
    it(`${className} remains append-only without updated_at`, () => {
      const block = classBlock(source, className)
      expect(block).not.toBeNull()
      expect(block as string).not.toMatch(/@Property\(\{\s*name:\s*['"]updated_at['"]/)
    })
  }

  for (const { className, commandModule } of parentGuardedToggleEntities) {
    it(`${className} stays a field-less toggle exempt from updated_at`, () => {
      const block = classBlock(source, className)
      expect(block).not.toBeNull()
      expect(block as string).not.toMatch(/@Property\(\{\s*name:\s*['"]updated_at['"]/)
      expect(editableEntities as readonly string[]).not.toContain(className)
    })

    it(`${className} mutations are serialized by the parent document aggregate`, () => {
      const commandSource = readCommandSource(commandModule)
      const handlers = countOccurrences(commandSource, /async execute\(/g)
      const parentLocks = countOccurrences(commandSource, /await lockDocumentAggregateRoot\(/g)
      expect(handlers).toBeGreaterThan(0)
      expect(parentLocks).toBe(handlers)
    })
  }
})
