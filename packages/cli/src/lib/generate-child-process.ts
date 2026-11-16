import { spawn } from 'node:child_process'

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
}): Promise<void> {
  const args = [options.mercatoBin, 'generate', 'all']
  if (options.quiet) args.push('--quiet')

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    child.once('error', reject)
    // Wait for close, not just exit: generation and inherited stream cleanup
    // must finish before another cycle or supervisor restart can proceed.
    child.once('close', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(
        signal
          ? `Generator process terminated by ${signal}`
          : `Generator process exited with code ${code ?? 'unknown'}`,
      ))
    })
  })
}
