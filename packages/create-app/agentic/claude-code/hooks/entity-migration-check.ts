/**
 * Claude Code PostToolUse hook: entity-migration-check
 *
 * Fires after Write/Edit/MultiEdit. Detects entity file modifications
 * without an accompanying migration and blocks the agent with a reminder.
 *
 * Three-state logic:
 * 1. Migration file was written → exit 0 (agent is already on it)
 * 2. Not an entity file → exit 0 (not relevant)
 * 3. Entity written, no fresh migration → block with migration instructions
 */

import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ENTITY_PATTERN = /^src\/modules\/([^/]+)\/entities\/.*\.ts$/
const MIGRATION_PATTERN = /^src\/modules\/([^/]+)\/migrations\/.*\.ts$/

interface PostToolUseInput {
  tool_input?: {
    file_path?: string
    content?: string
  }
  tool_name?: string
}

function getRelativePath(filePath: string): string {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  if (filePath.startsWith('/')) {
    return relative(projectDir, filePath)
  }
  return filePath
}

function hasFreshMigration(moduleId: string): boolean {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  const migrationsDir = join(projectDir, 'src', 'modules', moduleId, 'migrations')

  try {
    const files = readdirSync(migrationsDir)
    const now = Date.now()
    const thirtySecondsAgo = now - 30_000

    for (const file of files) {
      if (!file.endsWith('.ts')) continue
      const stat = statSync(join(migrationsDir, file))
      if (stat.mtimeMs > thirtySecondsAgo) {
        return true
      }
    }
  } catch {
    // migrations directory doesn't exist yet — that's fine
  }

  return false
}

async function main(): Promise<void> {
  let input = ''
  for await (const chunk of process.stdin) {
    input += chunk
  }

  if (!input.trim()) {
    process.exit(0)
  }

  let data: PostToolUseInput
  try {
    data = JSON.parse(input)
  } catch {
    process.exit(0)
  }

  const filePath = data.tool_input?.file_path
  if (!filePath) {
    process.exit(0)
  }

  const rel = getRelativePath(filePath)

  // State 1: Migration file was written → agent is already handling it
  if (MIGRATION_PATTERN.test(rel)) {
    process.exit(0)
  }

  // State 2: Not an entity file → not relevant
  const entityMatch = rel.match(ENTITY_PATTERN)
  if (!entityMatch) {
    process.exit(0)
  }

  const moduleId = entityMatch[1]

  // State 3: Entity written — check for fresh migration
  if (hasFreshMigration(moduleId)) {
    process.exit(0)
  }

  // Block: entity modified without migration
  const result = {
    decision: 'block',
    reason: [
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
    ].join('\n'),
  }

  process.stdout.write(JSON.stringify(result))
}

main()
