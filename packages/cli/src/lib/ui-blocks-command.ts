import path from 'node:path'
import { BLOCK_TARGET_DIR } from './ui-blocks-source'
import {
  addBlock,
  diffBlock,
  listAvailableBlocks,
  listInstalledBlockIds,
  type BlockDiffResult,
  type UiBlocksContext,
} from './ui-blocks'

export type UiCommandArgs = {
  positionals: string[]
  moduleId: string | null
  force: boolean
  json: boolean
  exitCode: boolean
  help: boolean
}

export type UiCommandIo = {
  log: (message: string) => void
  error: (message: string) => void
}

const USAGE = [
  'Usage: yarn mercato ui <list|add|diff> ...',
  '  yarn mercato ui list [--json]',
  '  yarn mercato ui add <block> --module <moduleId> [--force] [--json]',
  '  yarn mercato ui diff [<block>] --module <moduleId> [--exit-code] [--json]',
  '',
  `Blocks are copied into src/modules/<moduleId>/${BLOCK_TARGET_DIR}/<block>/ and tracked in blocks.lock.json.`,
  'Prefer importing from @open-mercato/ui/blocks/<block>; copy only when the module needs a different structure.',
]

export function parseUiCommandArgs(args: readonly string[]): UiCommandArgs {
  const parsed: UiCommandArgs = { positionals: [], moduleId: null, force: false, json: false, exitCode: false, help: false }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--module' || arg === '-m') {
      parsed.moduleId = args[index + 1] ?? null
      index += 1
    } else if (arg.startsWith('--module=')) {
      parsed.moduleId = arg.slice('--module='.length) || null
    } else if (arg === '--force') {
      parsed.force = true
    } else if (arg === '--json') {
      parsed.json = true
    } else if (arg === '--exit-code') {
      parsed.exitCode = true
    } else if (arg === '--help' || arg === '-h' || arg === 'help') {
      parsed.help = true
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option "${arg}".`)
    } else {
      parsed.positionals.push(arg)
    }
  }
  return parsed
}

function printDiff(result: BlockDiffResult, io: UiCommandIo): void {
  const versionLine = result.lockedVersion
    ? `installed from ${result.lockedVersion}, registry is ${result.registryVersion}${result.registryChanged ? ' (source changed)' : ''}`
    : `not tracked in blocks.lock.json, registry is ${result.registryVersion}`
  io.log(`${result.blockId} in ${result.moduleId}: ${versionLine}`)
  if (result.files.length === 0) {
    io.log('  No differences from the registry version.')
    return
  }
  io.log(`  Local changes: ${result.localEdits.length > 0 ? result.localEdits.join(', ') : 'none'}`)
  for (const file of result.files) {
    io.log('')
    if (file.status === 'missing-locally') io.log(`  ${file.path}: in the registry, missing locally`)
    if (file.status === 'local-only') io.log(`  ${file.path}: local file, not in the registry`)
    io.log(file.patch.trimEnd())
  }
}

export function runUiCommand(args: readonly string[], context: UiBlocksContext, io: UiCommandIo): number {
  const [subcommand, ...rest] = args
  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    for (const line of USAGE) io.log(line)
    return 0
  }

  const parsed = parseUiCommandArgs(rest)
  if (parsed.help) {
    for (const line of USAGE) io.log(line)
    return 0
  }

  if (subcommand === 'list') {
    const blocks = listAvailableBlocks(context).map((block) => ({
      id: block.id,
      package: block.packageName,
      packageVersion: block.packageVersion,
      hash: block.hash,
      files: block.files.map((file) => file.path),
    }))
    if (parsed.json) {
      io.log(JSON.stringify({ version: 1, blocks }, null, 2))
      return 0
    }
    if (blocks.length === 0) {
      io.log('No copyable blocks found in the installed @open-mercato/ui package.')
      return 0
    }
    for (const block of blocks) io.log(`${block.id}  (${block.files.length} files, ${block.package}@${block.packageVersion})`)
    io.log('')
    io.log('Copy one with: yarn mercato ui add <block> --module <moduleId>')
    return 0
  }

  if (subcommand === 'add') {
    const blockId = parsed.positionals[0]
    if (!blockId || !parsed.moduleId) {
      io.error('Usage: yarn mercato ui add <block> --module <moduleId> [--force] [--json]')
      return 1
    }
    const result = addBlock(context, blockId, parsed.moduleId, { force: parsed.force })
    if (parsed.json) {
      io.log(
        JSON.stringify(
          {
            ...result,
            targetDir: path.relative(context.appDir, result.targetDir),
            lockPath: path.relative(context.appDir, result.lockPath),
          },
          null,
          2,
        ),
      )
      return 0
    }
    const targetLabel = path.relative(context.appDir, result.targetDir)
    if (result.action === 'unchanged') {
      io.log(`Block "${blockId}" in ${targetLabel} already matches @open-mercato/ui ${result.packageVersion}.`)
      return 0
    }
    io.log(`Block "${blockId}" ${result.action} in ${targetLabel} from @open-mercato/ui ${result.packageVersion}.`)
    for (const filePath of result.written) io.log(`  wrote ${filePath}`)
    for (const filePath of result.removed) io.log(`  removed ${filePath}`)
    io.log(`  lock ${path.relative(context.appDir, result.lockPath)}`)
    return 0
  }

  if (subcommand === 'diff') {
    if (!parsed.moduleId) {
      io.error('Usage: yarn mercato ui diff [<block>] --module <moduleId> [--exit-code] [--json]')
      return 1
    }
    const moduleId = parsed.moduleId
    const blockIds = parsed.positionals.length > 0 ? parsed.positionals : listInstalledBlockIds(context, moduleId)
    if (blockIds.length === 0) {
      io.log(`Module "${moduleId}" has no copied blocks.`)
      return 0
    }
    const results = blockIds.map((blockId) => diffBlock(context, blockId, moduleId))
    if (parsed.json) {
      io.log(JSON.stringify({ version: 1, blocks: results }, null, 2))
    } else {
      results.forEach((result, index) => {
        if (index > 0) io.log('')
        printDiff(result, io)
      })
    }
    const differs = results.some((result) => result.files.length > 0)
    return parsed.exitCode && differs ? 1 : 0
  }

  io.error(`Unknown ui subcommand "${subcommand}".`)
  for (const line of USAGE) io.error(line)
  return 1
}
