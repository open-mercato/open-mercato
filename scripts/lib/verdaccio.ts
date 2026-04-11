import path from 'node:path'
import { spawnSync } from 'node:child_process'

export const VERDACCIO_URL = process.env.VERDACCIO_URL ?? 'http://localhost:4873'

export function createStandaloneInstallEnv(cacheRoot: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    YARN_ENABLE_IMMUTABLE_INSTALLS: '0',
    YARN_ENABLE_GLOBAL_CACHE: '0',
    YARN_ENABLE_MIRROR: '0',
    YARN_CACHE_FOLDER: path.join(cacheRoot, '.yarn-cache'),
  }
}

type RunOptions = {
  cwd: string
  input?: string
  env?: NodeJS.ProcessEnv
  silent?: boolean
}

/** @internal */
export function resolveWindowsCommandShim(command: string, args: string[], platform = process.platform): { command: string; args: string[] } {
  if (platform !== 'win32') {
    return { command, args }
  }

  const binary = command.toLowerCase() === 'yarn' ? 'yarn.cmd' : command
  if (!binary.toLowerCase().endsWith('.cmd')) {
    return { command: binary, args }
  }

  return { command: 'cmd.exe', args: ['/d', '/s', '/c', binary, ...args] }
}

export function runCommand(command: string, args: string[], options: RunOptions): string {
  const label = [command, ...args].join(' ')
  if (!options.silent) {
    console.log(`\n$ ${label}`)
  }

  const commandSpec = resolveWindowsCommandShim(command, args)
  const result = spawnSync(commandSpec.command, commandSpec.args, {
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
