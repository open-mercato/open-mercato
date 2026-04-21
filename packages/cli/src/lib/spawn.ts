export function isWindowsCmdScript(command: string, platform = process.platform): boolean {
  return platform === 'win32' && /\.(cmd|bat)$/i.test(String(command))
}

const WINDOWS_CMD_UNSAFE_CHAR_PATTERN = /[\u0000-\u001f\u007f%!]/

function assertWindowsCmdSafeValue(value: string, label: string): string {
  if (WINDOWS_CMD_UNSAFE_CHAR_PATTERN.test(value)) {
    throw new Error(`${label} contains unsupported characters for Windows command execution.`)
  }

  return value
}

function quoteWindowsShellArgument(value: string): string {
  if (value.length === 0) {
    return '""'
  }

  if (!/[\s"&()<>^|]/.test(value)) {
    return value
  }

  return `"${value.replace(/"/g, '""')}"`
}

export function resolveSpawnCommand(
  command: string,
  commandArgs: string[] = [],
  options: { platform?: NodeJS.Platform } = {},
): {
  command: string
  args: string[]
  spawnOptions: { shell?: boolean; windowsVerbatimArguments?: boolean }
} {
  const platform = options.platform ?? process.platform

  if (!isWindowsCmdScript(command, platform)) {
    return {
      command,
      args: commandArgs,
      spawnOptions: {},
    }
  }

  const safeCommand = assertWindowsCmdSafeValue(String(command), 'Windows command path')
  const safeArgs = commandArgs.map((arg, index) =>
    assertWindowsCmdSafeValue(String(arg), `Windows command argument #${index + 1}`),
  )

  return {
    command: 'cmd.exe',
    args: [
      '/d',
      '/s',
      '/c',
      [quoteWindowsShellArgument(safeCommand), ...safeArgs.map((arg) => quoteWindowsShellArgument(arg))].join(' '),
    ],
    spawnOptions: { windowsVerbatimArguments: true },
  }
}
