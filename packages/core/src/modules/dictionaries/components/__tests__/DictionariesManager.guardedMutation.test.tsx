/**
 * Regression for #3219: dictionary UI writes must flow through
 * useGuardedMutation(...).runMutation(...) so global mutation injections
 * (record-lock conflict handling, onBeforeSave/onAfterSave hooks) run
 * consistently instead of being bypassed by raw apiCall writes.
 *
 * This is a source-level guard: it asserts each write component imports
 * useGuardedMutation, obtains runMutation + retryLastMutation, and that no
 * mutating apiCall (POST/PUT/PATCH/DELETE) is issued outside a runMutation
 * operation callback. A static check keeps the regression fast and stable
 * (no DOM/effect timing) while still failing if a future edit reintroduces a
 * raw mutating apiCall.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const componentsDir = join(__dirname, '..')

const WRITE_COMPONENTS = [
  'DictionariesManager.tsx',
  'DictionaryEntriesEditor.tsx',
  'DictionarySelectControl.tsx',
] as const

function read(file: string): string {
  return readFileSync(join(componentsDir, file), 'utf8')
}

describe('dictionaries write components — guarded mutation wiring (#3219)', () => {
  it.each(WRITE_COMPONENTS)('%s imports and uses useGuardedMutation', (file) => {
    const source = read(file)
    expect(source).toContain(
      "from '@open-mercato/ui/backend/injection/useGuardedMutation'",
    )
    expect(source).toContain('useGuardedMutation')
    expect(source).toContain('runMutation')
    expect(source).toContain('retryLastMutation')
  })

  it.each(WRITE_COMPONENTS)(
    '%s routes every mutating apiCall through a runMutation operation',
    (file) => {
      const source = read(file)
      const mutatingApiCalls =
        source.match(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/g) ?? []
      const runMutationCalls = source.match(/runMutation\(/g) ?? []
      // Each mutating write must be wrapped in its own runMutation operation, so
      // there must be at least as many runMutation calls as mutating apiCalls.
      expect(runMutationCalls.length).toBeGreaterThanOrEqual(mutatingApiCalls.length)
      expect(mutatingApiCalls.length).toBeGreaterThan(0)
    },
  )

  it('DictionariesManager still derives the optimistic-lock header for update and delete', () => {
    const source = read('DictionariesManager.tsx')
    expect(source).toContain('buildOptimisticLockHeader')
    expect(source).toContain('withScopedApiRequestHeaders')
    expect(source).toContain('surfaceRecordConflict')
  })

  it('DictionaryEntriesEditor still derives the optimistic-lock header for update and delete', () => {
    const source = read('DictionaryEntriesEditor.tsx')
    expect(source).toContain('buildOptimisticLockHeader')
    expect(source).toContain('withScopedApiRequestHeaders')
    expect(source).toContain('surfaceRecordConflict')
  })
})
