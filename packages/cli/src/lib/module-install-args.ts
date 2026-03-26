export type ParsedModuleInstallArgs = {
  packageSpec: string | null
  eject: boolean
  moduleId: string | null
}

export function parseModuleInstallArgs(args: string[]): ParsedModuleInstallArgs {
  let packageSpec: string | null = null
  let eject = false
  let moduleId: string | null = null

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg) continue

    if (arg === '--eject') {
      eject = true
      continue
    }

    if (arg.startsWith('--eject=')) {
      throw new Error('--eject does not accept a value')
    }

    if (arg === '--module') {
      const next = args[index + 1]
      if (next && !next.startsWith('-')) {
        moduleId = next
        index += 1
        continue
      }
      throw new Error(`--module requires a moduleId value`)
    }

    if (arg.startsWith('--module=')) {
      moduleId = arg.slice('--module='.length) || null
      continue
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unsupported option: ${arg}`)
    }

    if (!arg.startsWith('-') && !packageSpec) {
      packageSpec = arg
    }
  }

  return { packageSpec, eject, moduleId }
}
