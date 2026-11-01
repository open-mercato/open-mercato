import fs from 'node:fs'
import path from 'node:path'

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations')

/**
 * The module's ONE squash migration, resolved by shape rather than by filename.
 *
 * The migration convention here is squash-not-stack, so re-squashing mints a new
 * timestamped file and every test that hard-coded the old name breaks — which is
 * a broken test, not a broken invariant. Resolving the single file in the
 * directory keeps the invariants asserted across re-squashes, and asserts the
 * "exactly one" part of the convention while it is at it.
 *
 * Only `Migration<ts>_agent_orchestrator.ts` is the squash. Additive changes made
 * after the squash shipped in a release stack as their own descriptively named
 * files (`Migration<ts>_<change>.ts`) so upgraded databases receive them; they
 * are not matched here.
 */
export function readSquashMigrationSql(): string {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^Migration\d+_agent_orchestrator\.ts$/.test(name))
    .sort()
  if (files.length !== 1) {
    throw new Error(
      `[internal] expected exactly one squashed agent_orchestrator migration, found ${files.length}: ${files.join(', ')}`,
    )
  }
  return fs.readFileSync(path.join(MIGRATIONS_DIR, files[0]), 'utf8')
}
