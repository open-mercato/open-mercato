import { spawn } from 'node:child_process'
import fs from 'node:fs'
import type { GenerateWatchPlan } from './generate-watch-plan'

type GenerateWatchRequest = {
  plan?: GenerateWatchPlan
  logCascade: boolean
}

export function readGenerateWatchRequest(): GenerateWatchRequest | undefined {
  if (process.env.OM_INTERNAL_GENERATE_WATCH_REQUEST !== '1') return undefined
  delete process.env.OM_INTERNAL_GENERATE_WATCH_REQUEST
  return JSON.parse(fs.readFileSync(0, 'utf8')) as GenerateWatchRequest
}

/**
 * Evaluate application modules in a disposable process, never in the watcher.
 * Native ESM keeps every cache-busted module revision until its process exits;
 * a fresh process also observes edits to unchanged modules' imported dependencies.
 */
export async function runGenerateChildProcess(options: {
  mercatoBin: string
  cwd: string
  env?: NodeJS.ProcessEnv
  quiet?: boolean
  watchRequest?: GenerateWatchRequest
}): Promise<void> {
  const args = [options.mercatoBin, 'generate', 'all']
  if (options.quiet) args.push('--quiet')

  await new Promise<void>((resolve, reject) => {
    let inputError: Error | undefined
    const child = spawn(process.execPath, args, {
      cwd: options.cwd,
      env: {
        ...(options.env ?? process.env),
        OM_INTERNAL_GENERATE_WATCH_REQUEST: options.watchRequest ? '1' : undefined,
      },
      stdio: [options.watchRequest ? 'pipe' : 'ignore', 'inherit', 'inherit'],
    })
    child.once('error', reject)
    if (options.watchRequest) {
      child.stdin?.on('error', (error: Error) => { inputError = error })
      child.stdin?.end(JSON.stringify(options.watchRequest))
    }
    // Wait for close, not just exit: generation and inherited stream cleanup
    // must finish before another cycle or supervisor restart can proceed.
    child.once('close', (code, signal) => {
      if (inputError) reject(inputError)
      else if (code === 0) resolve()
      else reject(new Error(
        signal
          ? `Generator process terminated by ${signal}`
          : `Generator process exited with code ${code ?? 'unknown'}`,
      ))
    })
  })
}
