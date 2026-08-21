import path from 'node:path'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import {
  BackupServiceError,
  createBackupServiceFromEnvironment,
  listBackupManifests,
} from './lib/backupService'

type ParsedArgs = {
  flags: Record<string, string | boolean>
  positionals: string[]
}

function parseArgs(args: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {}
  const positionals: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (!value) continue
    if (!value.startsWith('--')) {
      positionals.push(value)
      continue
    }
    const separator = value.indexOf('=')
    if (separator > 2) {
      flags[value.slice(2, separator)] = value.slice(separator + 1)
      continue
    }
    const key = value.slice(2)
    const next = args[index + 1]
    if (next && !next.startsWith('--')) {
      flags[key] = next
      index += 1
    } else {
      flags[key] = true
    }
  }
  return { flags, positionals }
}

function stringFlag(args: ParsedArgs, key: string): string | undefined {
  const value = args.flags[key]
  return typeof value === 'string' ? value : undefined
}

function hasFlag(args: ParsedArgs, key: string): boolean {
  return args.flags[key] === true
}

function actorFrom(args: ParsedArgs): string {
  const actor = stringFlag(args, 'actor') ?? process.env.OM_BACKUP_ACTOR
  if (!actor?.trim()) {
    throw new BackupServiceError('Pass --actor <id> or set OM_BACKUP_ACTOR.', 'ACTOR_REQUIRED')
  }
  return actor.trim()
}

function directoryFrom(args: ParsedArgs): string {
  return path.resolve(
    stringFlag(args, 'directory')
      ?? process.env.OM_BACKUP_DIRECTORY
      ?? path.join('.mercato', 'backups'),
  )
}

function printHelp(): void {
  console.log('Usage: yarn mercato backups <command> [options]')
  console.log('')
  console.log('Commands:')
  console.log('  run [--label <text>] [--actor <id>] [--directory <path>]')
  console.log('  list [--directory <path>] [--json]')
  console.log('  verify <operationId|manifest|archive> [--actor <id>] [--directory <path>]')
  console.log('  restore <operationId|manifest|archive> --dry-run [--actor <id>]')
  console.log('  restore <operationId|manifest|archive> --force --confirm <database> [--allow-version-mismatch] [--actor <id>]')
  console.log('')
  console.log('Secrets and database URLs are read only from environment variables.')
}

async function runCommand(input: () => Promise<void>): Promise<void> {
  try {
    await input()
  } catch (error) {
    const normalized = error instanceof BackupServiceError
      ? error
      : new BackupServiceError(error instanceof Error ? error.message : 'Backup command failed.', 'COMMAND_FAILED')
    console.error(`[backups] ${normalized.message} (${normalized.code})`)
    process.exitCode = 1
  }
}

const runBackup: ModuleCli = {
  command: 'run',
  async run(rest) {
    await runCommand(async () => {
      const args = parseArgs(rest)
      const service = createBackupServiceFromEnvironment({
        actor: actorFrom(args),
        backupDirectory: directoryFrom(args),
      })
      const result = await service.backup({ label: stringFlag(args, 'label') })
      if (hasFlag(args, 'json')) {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      console.log(`[backups] Backup completed: ${result.operationId}`)
      console.log(`[backups] Archive: ${result.archivePath}`)
      console.log(`[backups] SHA-256: ${result.manifest.archive.checksumSha256}`)
      console.log(`[backups] Schema: ${result.manifest.schema.version}`)
    })
  },
}

const listBackups: ModuleCli = {
  command: 'list',
  async run(rest) {
    await runCommand(async () => {
      const args = parseArgs(rest)
      const entries = await listBackupManifests(directoryFrom(args))
      if (hasFlag(args, 'json')) {
        console.log(JSON.stringify(entries, null, 2))
        return
      }
      if (entries.length === 0) {
        console.log('[backups] No backups found.')
        return
      }
      for (const entry of entries) {
        console.log([
          entry.manifest.operationId,
          entry.manifest.completedAt,
          `${entry.manifest.archive.sizeBytes} bytes`,
          entry.manifest.schema.version,
          entry.manifest.label ?? '',
        ].join('\t'))
      }
    })
  },
}

const verifyBackup: ModuleCli = {
  command: 'verify',
  async run(rest) {
    await runCommand(async () => {
      const args = parseArgs(rest)
      const reference = args.positionals[0]
      if (!reference) {
        throw new BackupServiceError('Pass a backup operation ID, manifest, or archive path.', 'REFERENCE_REQUIRED')
      }
      const service = createBackupServiceFromEnvironment({
        actor: actorFrom(args),
        backupDirectory: directoryFrom(args),
      })
      const result = await service.verify(reference)
      if (hasFlag(args, 'json')) {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      console.log(`[backups] Verification completed: ${result.manifest.operationId}`)
      console.log(`[backups] SHA-256: ${result.manifest.archive.checksumSha256}`)
    })
  },
}

const restoreBackup: ModuleCli = {
  command: 'restore',
  async run(rest) {
    await runCommand(async () => {
      const args = parseArgs(rest)
      const reference = args.positionals[0]
      if (!reference) {
        throw new BackupServiceError('Pass a backup operation ID, manifest, or archive path.', 'REFERENCE_REQUIRED')
      }
      const service = createBackupServiceFromEnvironment({
        actor: actorFrom(args),
        backupDirectory: directoryFrom(args),
      })
      const result = await service.restore({
        reference,
        dryRun: hasFlag(args, 'dry-run'),
        force: hasFlag(args, 'force'),
        confirmDatabase: stringFlag(args, 'confirm'),
        allowVersionMismatch: hasFlag(args, 'allow-version-mismatch'),
      })
      if (hasFlag(args, 'json')) {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      const action = result.dryRun ? 'Restore dry-run completed' : 'Restore completed'
      console.log(`[backups] ${action}: ${result.manifest.operationId}`)
      console.log(`[backups] Operation receipt: ${result.operationId}`)
    })
  },
}

const help: ModuleCli = {
  command: 'help',
  run() {
    printHelp()
  },
}

const backupCliCommands = [runBackup, listBackups, verifyBackup, restoreBackup, help]

export default backupCliCommands
