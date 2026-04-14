function isWindowsCmdScript(command, platform = process.platform) {
  return platform === 'win32' && /\.(cmd|bat)$/i.test(String(command))
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

  const shellCommand = [
    quoteWindowsShellArgument(command),
    ...commandArgs.map((arg) => quoteWindowsShellArgument(arg)),
  ].join(' ')

  return {
    command: shellCommand,
    args: [],
    spawnOptions: { shell: true },
  }
}

