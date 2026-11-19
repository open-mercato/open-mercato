// Cross-platform helpers for spawning package-manager CLIs from repo scripts.
//
// Never spawn `npm.cmd` / `npx.cmd` / `yarn.cmd` shims looked up on PATH:
// Node >= 18.20 rejects .cmd files without a shell (EINVAL), and cmd.exe
// decodes batch files with the OEM code page, which corrupts non-ASCII
// checkout paths (see scripts/dev-spawn-utils.mjs for the full story).
// Instead resolve each tool's JS entry and run it with the current Node
// executable, so every path stays inside wide-char argv.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

// npm and npx ship next to the Node executable: `node_modules/npm/bin/` on
// Windows installs, `../lib/node_modules/npm/bin/` on POSIX installs.
export function resolveNodeBundledCli(tool, { platform = process.platform, execPath = process.execPath } = {}) {
  const cliFile = `${tool}-cli.js`
  const candidates = [
    join(dirname(execPath), 'node_modules', 'npm', 'bin', cliFile),
    join(dirname(execPath), '..', 'lib', 'node_modules', 'npm', 'bin', cliFile),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return { command: execPath, prefixArgs: [candidate] }
  }
  if (platform !== 'win32') return { command: tool, prefixArgs: [] }
  return null
}

// Yarn Berry sets npm_execpath to its own .cjs bundle for every package
// script, so `yarn <script>` children can always re-enter yarn through Node.
export function resolveYarnInvocation({
  env = process.env,
  platform = process.platform,
  execPath = process.execPath,
} = {}) {
  const npmExecPath = env.npm_execpath
  if (npmExecPath && /\.(cjs|mjs|js)$/i.test(npmExecPath) && existsSync(npmExecPath)) {
    return { command: execPath, prefixArgs: [npmExecPath] }
  }
  if (platform !== 'win32') return { command: 'yarn', prefixArgs: [] }
  return null
}

export function runCli(invocation, args, { cwd, env, stdio = 'inherit' } = {}) {
  const result = spawnSync(invocation.command, [...invocation.prefixArgs, ...args], { cwd, env, stdio })
  if (result.error?.code === 'ENOENT') return null
  return result.status === 0
}
