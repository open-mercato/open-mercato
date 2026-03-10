/**
 * Cursor afterFileEdit hook: entity-migration-check
 *
 * Detects entity file modifications without an accompanying migration
 * and exits non-zero to block the agent with a reminder.
 *
 * Three-state logic:
 * 1. Migration file was written → exit 0 (agent is already on it)
 * 2. Not an entity file → exit 0 (not relevant)
 * 3. Entity written, no fresh migration → exit 1 with warning
 */

import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ENTITY_RE = /^src\/modules\/([^/]+)\/entities\/.*\.ts$/
const MIGRATION_RE = /^src\/modules\/([^/]+)\/migrations\/.*\.ts$/

function hasFreshMigration(projectDir, moduleId) {
  const migrationsDir = join(projectDir, 'src', 'modules', moduleId, 'migrations')
  try {
    const files = readdirSync(migrationsDir)
    const cutoff = Date.now() - 30_000
    for (const file of files) {
      if (!file.endsWith('.ts')) continue
      const stat = statSync(join(migrationsDir, file))
      if (stat.mtimeMs > cutoff) return true
    }
  } catch {
    // migrations directory doesn't exist yet
  }
  return false
}

const filePath = process.argv[2]
if (!filePath) process.exit(0)

const projectDir = resolve('.')
const rel = filePath.startsWith('/') ? filePath.slice(projectDir.length + 1) : filePath

// State 1: Migration file written
if (MIGRATION_RE.test(rel)) process.exit(0)

// State 2: Not an entity file
const match = rel.match(ENTITY_RE)
if (!match) process.exit(0)

const moduleId = match[1]

// State 3: Entity file without fresh migration
if (hasFreshMigration(projectDir, moduleId)) process.exit(0)

process.stderr.write(
  [
    `Entity file modified: ${rel}`,
    '',
    `Affected module: ${moduleId}`,
    '',
    'A database migration is likely needed. Ask the user whether to run:',
    '  yarn db:generate',
    '',
    'Then regenerate registries:',
    '  yarn generate',
    '',
    'Do NOT run migrations automatically — always confirm with the user first.',
    '',
  ].join('\n'),
)
process.exit(1)
