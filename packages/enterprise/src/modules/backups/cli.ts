import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { backupEntityLabels } from './lib/labels'
import { atomicStream } from './lib/engine/artifacts'
import { bytes } from './lib/engine/streams'
import { parseArgs } from 'node:util'
import { isAbsolute } from 'node:path'
import { runBackupCli } from './lib/engine/cli/main'
const commands = ['configure', 'preflight', 'create', 'status', 'verify', 'restore', 'exercise'] as const
const cli: ModuleCli[] = commands.map((command) => ({
  command,
  async run(rest) {
    const code = await runBackupCli([command, ...rest], { stdout: (text) => process.stdout.write(text), stderr: (text) => process.stderr.write(text), appWrapper: true, labels: command === 'create' ? backupEntityLabels() : undefined })
    if (code !== 0) throw new Error('[internal] BACKUP_COMMAND_FAILED')
  },
}))
cli.push({ command: 'labels', async run(rest) {
  const { values } = parseArgs({ args: rest, strict: true, options: { output: { type: 'string' } } })
  if (!values.output || !isAbsolute(values.output)) throw new Error('[internal] BACKUP_ABSOLUTE_PATH_REQUIRED')
  await atomicStream(values.output, bytes(Buffer.from(JSON.stringify(backupEntityLabels()))))
} })
export default cli
