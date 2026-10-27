import fs from 'node:fs'
import path from 'node:path'

function isWindowsCmdScript(command, platform = process.platform) {
  return platform === 'win32' && /\.(cmd|bat)$/i.test(String(command))
}

const PROCESS_VALUE_UNSAFE_CHAR_PATTERN = /[\u0000-\u001f\u007f]/
const WINDOWS_CMD_UNSAFE_CHAR_PATTERN = /[\u0000-\u001f\u007f%!]/

function assertProcessSafeValue(value, label) {
  const stringValue = String(value)
  if (PROCESS_VALUE_UNSAFE_CHAR_PATTERN.test(stringValue)) {
    throw new Error(`${label} contains unsupported control characters.`)
  }

  return stringValue
}

function assertWindowsCmdSafeValue(value, label) {
  const stringValue = assertProcessSafeValue(value, label)
  if (WINDOWS_CMD_UNSAFE_CHAR_PATTERN.test(stringValue)) {
    throw new Error(`${label} contains unsupported characters for Windows command execution.`)
  }

  return stringValue
}

export function resolveProjectBinary(command, options = {}) {
  const safeCommand = assertProcessSafeValue(command, 'Process command')
  const cwd = options.cwd ?? process.cwd()
  const platform = options.platform ?? process.platform

  if (path.isAbsolute(safeCommand) || safeCommand.includes('/') || safeCommand.includes('\\')) {
    return safeCommand
  }

  const binDir = path.join(cwd, 'node_modules', '.bin')
  const candidates = platform === 'win32'
    ? [
        path.join(binDir, safeCommand),
        path.join(binDir, `${safeCommand}.cmd`),
        path.join(binDir, `${safeCommand}.bat`),
        path.join(binDir, `${safeCommand}.exe`),
      ]
    : [path.join(binDir, safeCommand)]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  return safeCommand
}

// Prefer invoking the mercato CLI's JS entry with the current Node executable
// instead of a `mercato.cmd` shim. Yarn Berry prepends a temp bin folder of
// generated .cmd wrappers to PATH when running package scripts; those wrappers
// embed absolute paths written as UTF-8, but cmd.exe decodes batch files with
// the OEM code page — a project path with non-ASCII characters (e.g. a Polish
// user profile) turns into mojibake and Node fails with MODULE_NOT_FOUND.
// Spawning `node <entry>` keeps every path inside wide-char argv, immune to
// code-page translation, and also sidesteps the Node >= 18.20 EINVAL rules
// for .cmd files.
const MERCATO_CLI_ENTRY_SEGMENTS = ['node_modules', '@open-mercato', 'cli', 'bin', 'mercato']

export function resolveMercatoInvocation(options = {}) {
  const cwd = options.cwd ?? process.cwd()
  const platform = options.platform ?? process.platform
  const execPath = options.execPath ?? process.execPath

  let currentDir = path.resolve(cwd)
  for (;;) {
    const candidate = path.join(currentDir, ...MERCATO_CLI_ENTRY_SEGMENTS)
    if (fs.existsSync(candidate)) {
      return { command: execPath, args: [candidate] }
    }
    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) break
    currentDir = parentDir
  }

  return {
    command: resolveProjectBinary(platform === 'win32' ? 'mercato.cmd' : 'mercato', { cwd, platform }),
    args: [],
  }
}

export function resolveSpawnCommand(command, commandArgs = [], options = {}) {
  const platform = options.platform ?? process.platform
  const safeCommand = assertProcessSafeValue(command, 'Process command')
  const safeArgs = commandArgs.map((arg, index) => assertProcessSafeValue(arg, `Process argument #${index + 1}`))

  if (!isWindowsCmdScript(safeCommand, platform)) {
    return {
      command: safeCommand,
      args: safeArgs,
      spawnOptions: {},
    }
  }

  return {
    command: assertWindowsCmdSafeValue(safeCommand, 'Windows command path'),
    args: safeArgs.map((arg, index) =>
      assertWindowsCmdSafeValue(arg, `Windows command argument #${index + 1}`),
    ),
    spawnOptions: {},
  }
}
