export function isWindowsCmdScript(command: string, platform = process.platform): boolean {
  return platform === 'win32' && /\.(cmd|bat)$/i.test(String(command))
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
  spawnOptions: { shell?: boolean }
} {
  const platform = options.platform ?? process.platform

  if (!isWindowsCmdScript(command, platform)) {
    return {
      command,
      args: commandArgs,
      spawnOptions: {},
    }
  }

  return {
    command: [quoteWindowsShellArgument(command), ...commandArgs.map((arg) => quoteWindowsShellArgument(String(arg)))].join(' '),
    args: [],
    spawnOptions: { shell: true },
  }
}
