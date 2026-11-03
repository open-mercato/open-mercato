// Windows-aware spawn resolution, mirroring scripts/dev-spawn-utils.mjs (the
// repo-wide hardening against cmd.exe argument injection) without its
// cross-spawn dependency - this package must stay stdlib-only so it runs from
// a fresh clone and via npx.
//
// yarn/npm/corepack are .cmd shims on Windows and Node >= 18.20 refuses to
// spawn those without a shell. Going through cmd.exe means every byte of the
// command line is metacharacter territory, so:
//   * commands and args are validated (control chars always; %, !, and cmd
//     metacharacters when a shell is involved)
//   * args with whitespace are double-quoted
// Anything that fails validation aborts the spawn instead of degrading into
// an injectable command line.

import { spawnSync } from 'node:child_process'
import path from 'node:path'

const PROCESS_VALUE_UNSAFE_CHAR_PATTERN = /[\u0000-\u001f\u007f]/
const WINDOWS_CMD_UNSAFE_CHAR_PATTERN = /[\u0000-\u001f\u007f%!^&|<>"]/

const WINDOWS_SHELL_COMMANDS = new Set(['yarn', 'npm', 'corepack', 'npx'])

function isWindowsShellCommand(command) {
  return WINDOWS_SHELL_COMMANDS.has(command) || /\.(cmd|bat)$/i.test(command)
}

function assertProcessSafeValue(value, label) {
  const stringValue = String(value)
  if (PROCESS_VALUE_UNSAFE_CHAR_PATTERN.test(stringValue)) {
    throw new Error(label + ' contains unsupported control characters.')
  }
  return stringValue
}

function assertWindowsCmdSafeValue(value, label) {
  const stringValue = assertProcessSafeValue(value, label)
  if (WINDOWS_CMD_UNSAFE_CHAR_PATTERN.test(stringValue)) {
    throw new Error(label + ' contains unsupported characters for Windows command execution.')
  }
  return stringValue
}

function quoteForCmd(value) {
  return /\s/.test(value) ? '"' + value + '"' : value
}

// cmd.exe decodes batch files with the code page the console had when the
// cmd process started — never as UTF-8. Yarn Berry writes its temp PATH
// wrappers and install-script shims (%TEMP%\xfs-*\*.cmd) as UTF-8 with
// absolute paths, so under an OEM code page (e.g. 852 on Polish systems) a
// checkout beneath a non-ASCII profile path turns into mojibake and every
// wrapped spawn — including native-module builds during `yarn install` —
// dies with MODULE_NOT_FOUND. Switching the console to UTF-8 before the
// first child spawn makes every descendant cmd.exe decode those wrappers
// correctly. Best-effort by design: no console (detached/CI) or a missing
// chcp.com must never block the starter.
export function ensureWindowsUtf8Console(options = {}) {
  const platform = options.platform ?? process.platform
  if (platform !== 'win32') return false
  const spawnSyncImpl = options.spawnSyncImpl ?? spawnSync
  const chcpPath = path.join(options.systemRoot ?? process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'chcp.com')
  try {
    // No windowsHide here: CREATE_NO_WINDOW would give chcp.com a throwaway
    // console instead of the one every later child inherits.
    const result = spawnSyncImpl(chcpPath, ['65001'], { stdio: 'ignore' })
    return result?.status === 0
  } catch {
    return false
  }
}

export function resolveSpawnCommand(command, commandArgs = [], options = {}) {
  const platform = options.platform ?? process.platform
  const safeCommand = assertProcessSafeValue(command, 'Process command')
  const safeArgs = commandArgs.map((arg, index) => assertProcessSafeValue(arg, 'Process argument #' + (index + 1)))

  const needsShell = platform === 'win32' && isWindowsShellCommand(safeCommand)
  if (!needsShell) {
    return { command: safeCommand, args: safeArgs, spawnOptions: {} }
  }

  // Everything is validated against cmd metacharacters and pre-quoted here, so
  // hand cmd.exe ONE finished command line. Passing an args array alongside
  // shell:true would make Node concatenate it unescaped (deprecated as DEP0190
  // since Node 24 — the warning lands on stderr, which PowerShell paints red).
  const cmdSafeCommand = quoteForCmd(assertWindowsCmdSafeValue(safeCommand, 'Windows command'))
  const cmdSafeArgs = safeArgs.map((arg, index) => quoteForCmd(assertWindowsCmdSafeValue(arg, 'Windows command argument #' + (index + 1))))
  return { command: [cmdSafeCommand, ...cmdSafeArgs].join(' '), args: [], spawnOptions: { shell: true } }
}
