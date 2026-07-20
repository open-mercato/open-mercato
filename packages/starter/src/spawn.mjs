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

const PROCESS_VALUE_UNSAFE_CHAR_PATTERN = /[\u0000-\u001f\u007f]/
const WINDOWS_CMD_UNSAFE_CHAR_PATTERN = /[\u0000-\u001f\u007f%!^&|<>"]/

const WINDOWS_SHELL_COMMANDS = new Set(['yarn', 'npm', 'corepack', 'npx'])

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

export function resolveSpawnCommand(command, commandArgs = [], options = {}) {
  const platform = options.platform ?? process.platform
  const safeCommand = assertProcessSafeValue(command, 'Process command')
  const safeArgs = commandArgs.map((arg, index) => assertProcessSafeValue(arg, 'Process argument #' + (index + 1)))

  const needsShell = platform === 'win32' && WINDOWS_SHELL_COMMANDS.has(safeCommand)
  if (!needsShell) {
    return { command: safeCommand, args: safeArgs, spawnOptions: {} }
  }

  assertWindowsCmdSafeValue(safeCommand, 'Windows command')
  const cmdSafeArgs = safeArgs.map((arg, index) => quoteForCmd(assertWindowsCmdSafeValue(arg, 'Windows command argument #' + (index + 1))))
  return { command: safeCommand, args: cmdSafeArgs, spawnOptions: { shell: true } }
}
