import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * data_sync guarded-mutation UI-coverage regression audit (#3213).
 *
 * `packages/ui/AGENTS.md` and `packages/ui/src/backend/AGENTS.md` require every
 * non-`CrudForm` backend UI write (`POST`/`PUT`/`PATCH`/`DELETE`) to route through
 * `useGuardedMutation(...).runMutation(...)` so mutations consistently run the
 * shared guard, injection, and conflict/error behavior.
 *
 * Some data_sync admin write flows previously called `apiCall` directly:
 * - `IntegrationScheduleTab` started runs and saved/deleted schedules raw.
 * - the run detail page cancelled/retried runs raw.
 *
 * This audit pins those files to the guarded-mutation contract: each must wire
 * `useGuardedMutation`, and any mutating `apiCall` (a `method:` of a write verb)
 * must sit inside a `runMutation({ operation: () => ... })` block rather than at
 * the top level of a handler.
 */

const moduleRoot = join(__dirname, '..')

const GUARDED_WRITE_FILES = [
  'components/IntegrationScheduleTab.tsx',
  'backend/data-sync/runs/[id]/page.tsx',
]

const WRITE_METHOD = /method:\s*['"](POST|PUT|PATCH|DELETE)['"]/i

function readModuleFile(relativePath: string): string {
  return readFileSync(join(moduleRoot, ...relativePath.split('/')), 'utf8')
}

describe('data_sync guarded-mutation UI coverage (#3213)', () => {
  it.each(GUARDED_WRITE_FILES)('%s wires useGuardedMutation', (relativePath) => {
    const source = readModuleFile(relativePath)
    expect(source).toContain('useGuardedMutation')
    expect(source).toContain('runMutation')
  })

  it.each(GUARDED_WRITE_FILES)('%s performs every write through runMutation', (relativePath) => {
    const source = readModuleFile(relativePath)
    const lines = source.split('\n')
    const writeLines = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => WRITE_METHOD.test(line))

    expect(writeLines.length).toBeGreaterThan(0)

    for (const { index } of writeLines) {
      const window = lines.slice(Math.max(0, index - 6), index).join('\n')
      expect(window).toMatch(/runMutation\(\{[\s\S]*operation:/)
    }
  })
})
