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
