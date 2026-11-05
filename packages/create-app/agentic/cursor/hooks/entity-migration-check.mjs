/** Remind Cursor to generate and review a schema diff after entity edits. */
import { readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ENTITY_RE = /^src\/modules\/([^/]+)\/data\/entities\.ts$/
const MIGRATION_RE = /^src\/modules\/([^/]+)\/migrations\/[^/]+\.ts$/

function hasFreshMigration(projectDir, moduleId) {
  const migrationsDir = join(projectDir, 'src', 'modules', moduleId, 'migrations')
  try {
    const cutoff = Date.now() - 30_000
    return readdirSync(migrationsDir).some((file) =>
      file.endsWith('.ts') && statSync(join(migrationsDir, file)).mtimeMs > cutoff,
    )
  } catch {
    return false
  }
}

const filePath = process.argv[2]
if (!filePath) process.exit(0)

const projectDir = resolve('.')
const rel = (filePath.startsWith('/') ? relative(projectDir, filePath) : filePath).replaceAll('\\', '/')
if (MIGRATION_RE.test(rel)) process.exit(0)

const match = rel.match(ENTITY_RE)
if (!match || hasFreshMigration(projectDir, match[1])) process.exit(0)

process.stderr.write([
  `Entity contract changed: ${rel}`,
  '',
  'Run `yarn db:generate` as a schema-diff probe and review only the scoped migration plus module snapshot.',
  'Run `yarn generate` when discovery changed.',
  'Do not apply the migration with `yarn db:migrate` without explicit user approval.',
  '',
].join('\n'))
process.exit(1)
