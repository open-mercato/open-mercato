/** Remind Claude Code to generate and review a schema diff after entity edits. */
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ENTITY_PATTERN = /^src\/modules\/([^/]+)\/data\/entities\.ts$/
const MIGRATION_PATTERN = /^src\/modules\/([^/]+)\/migrations\/[^/]+\.ts$/

interface PostToolUseInput {
  tool_input?: { file_path?: string }
}

function projectDir(): string {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd()
}

function normalizedRelative(filePath: string): string {
  const value = filePath.startsWith('/') ? relative(projectDir(), filePath) : filePath
  return value.replaceAll('\\', '/')
}

function hasFreshMigration(moduleId: string): boolean {
  const migrationsDir = join(projectDir(), 'src', 'modules', moduleId, 'migrations')
  try {
    const cutoff = Date.now() - 30_000
    return readdirSync(migrationsDir).some((file) =>
      file.endsWith('.ts') && statSync(join(migrationsDir, file)).mtimeMs > cutoff,
    )
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  if (!input.trim()) return

  let data: PostToolUseInput
  try {
    data = JSON.parse(input)
  } catch {
    return
  }

  const filePath = data.tool_input?.file_path
  if (!filePath) return
  const rel = normalizedRelative(filePath)
  if (MIGRATION_PATTERN.test(rel)) return

  const match = rel.match(ENTITY_PATTERN)
  if (!match || hasFreshMigration(match[1])) return

  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: [
      `Entity contract changed: ${rel}`,
      '',
      'Run `yarn db:generate` as a schema-diff probe and review only the scoped migration plus module snapshot.',
      'Run `yarn generate` when discovery changed.',
      'Do not apply the migration with `yarn db:migrate` without explicit user approval.',
    ].join('\n'),
  }))
}

void main()
