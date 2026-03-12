import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'

interface AgenticInitOptions {
  tool?: string
  force?: boolean
}

function parseArgs(args: string[]): AgenticInitOptions {
  const options: AgenticInitOptions = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--force' || arg === '-f') {
      options.force = true
    } else if (arg.startsWith('--tool=')) {
      options.tool = arg.slice('--tool='.length)
    } else if (arg === '--tool') {
      options.tool = args[++i]
    }
  }
  return options
}

export async function runAgenticInit(args: string[]): Promise<number> {
  const targetDir = resolve('.')
  const options = parseArgs(args)

  // Validate this is an Open Mercato app directory
  if (!existsSync(join(targetDir, 'src', 'modules.ts'))) {
    console.error('❌  Not an Open Mercato app directory (src/modules.ts not found)')
    return 1
  }

  // Check if agentic files already exist and warn unless --force
  if (!options.force) {
    const existingFiles = [
      'CLAUDE.md',
      '.claude/settings.json',
      '.cursor/hooks.json',
      '.codex/mcp.json.example',
    ].filter((f) => existsSync(join(targetDir, f)))

    if (existingFiles.length > 0) {
      console.log('')
      console.log('⚠️  Agentic files already exist:')
      for (const f of existingFiles) {
        console.log(`   • ${f}`)
      }
      console.log('')
      console.log('Run with --force to regenerate from current templates.')
      console.log('')
      return 0
    }
  }

  // Dynamic import of the setup wizard from create-app's agentic source
  // Since we can't import from create-app at runtime in standalone apps,
  // we inline the generator logic here using the same source files approach.
  const { runAgenticSetup } = await import('./agentic-setup.js')

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const ask = (q: string) => new Promise<string>((res) => rl.question(q, (a) => res(a.trim())))

  await runAgenticSetup(targetDir, ask, { tool: options.tool, force: options.force })
  rl.close()

  return 0
}
