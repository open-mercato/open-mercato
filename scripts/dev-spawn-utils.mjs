function isWindowsCmdScript(command, platform = process.platform) {
  return platform === 'win32' && /\.(cmd|bat)$/i.test(String(command))
}

const WINDOWS_CMD_UNSAFE_CHAR_PATTERN = /[\u0000-\u001f\u007f%!]/

function assertWindowsCmdSafeValue(value, label) {
  const stringValue = String(value)
  if (WINDOWS_CMD_UNSAFE_CHAR_PATTERN.test(stringValue)) {
    throw new Error(`${label} contains unsupported characters for Windows command execution.`)
  }

  return stringValue
}

function quoteWindowsShellArgument(value) {
  const stringValue = String(value)
  if (stringValue.length === 0) {
    return '""'
  }

  if (!/[\s"&()<>^|]/.test(stringValue)) {
    return stringValue
  }

  return `"${stringValue.replace(/"/g, '""')}"`
}

export function resolveSpawnCommand(command, commandArgs = [], options = {}) {
  const platform = options.platform ?? process.platform

  if (!isWindowsCmdScript(command, platform)) {
    return {
      command,
      args: commandArgs,
      spawnOptions: {},
    }
  }

  const safeCommand = assertWindowsCmdSafeValue(command, 'Windows command path')
  const safeArgs = commandArgs.map((arg, index) =>
    assertWindowsCmdSafeValue(arg, `Windows command argument #${index + 1}`),
  )

  return {
    command: 'cmd.exe',
    args: [
      '/d',
      '/s',
      '/c',
      [
        quoteWindowsShellArgument(safeCommand),
        ...safeArgs.map((arg) => quoteWindowsShellArgument(arg)),
      ].join(' '),
    ],
    spawnOptions: { windowsVerbatimArguments: true },
  }
}
