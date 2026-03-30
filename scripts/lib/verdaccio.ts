import path from 'node:path'
import { spawnSync } from 'node:child_process'

export const VERDACCIO_URL = process.env.VERDACCIO_URL ?? 'http://localhost:4873'

type RunOptions = {
  cwd: string
  input?: string
  env?: NodeJS.ProcessEnv
  silent?: boolean
}

export function runCommand(command: string, args: string[], options: RunOptions): string {
  const label = [command, ...args].join(' ')
  if (!options.silent) {
    console.log(`\n$ ${label}`)
  }

  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    input: options.input,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 128,
  })

  if (result.stdout && !options.silent) process.stdout.write(result.stdout)
  if (result.stderr && !options.silent) process.stderr.write(result.stderr)

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status ?? 'unknown'}): ${label}`)
  }

  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

export async function ensureVerdaccioPublished(rootDir: string): Promise<void> {
  runCommand('yarn', ['registry:publish'], { cwd: rootDir })
}

export function createAppBin(rootDir: string): string {
  return path.join(rootDir, 'packages', 'create-app', 'dist', 'index.js')
}
