const SECRET_OPTION_PATTERN = /password|passwd|passphrase|secret|token|credential|authorization|bearer|(?:api|private|signing|encryption|access|client)key|databaseurl|redisurl|connectionstring/i
const REDACTED = '****'

function isSecretName(name: string): boolean {
  return SECRET_OPTION_PATTERN.test(name.replace(/[-_]/g, ''))
}

function isSecretOption(argument: string): boolean {
  return argument.startsWith('-') && isSecretName(argument.split('=', 1)[0])
}

export function redactCliArgs(args: string[]): string[] {
  return args.map((argument, index) => {
    const previous = args[index - 1]
    if (previous && !previous.includes('=') && isSecretOption(previous)) return REDACTED
    const equalsIndex = argument.indexOf('=')
    if (equalsIndex >= 0 && isSecretOption(argument)) {
      return `${argument.slice(0, equalsIndex + 1)}${REDACTED}`
    }
    return argument
  })
}

export function redactCliText(
  text: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): string {
  const secrets = Object.entries(env)
    .filter(([name, value]) => isSecretName(name) && Boolean(value))
    .map(([, value]) => value as string)

  args.forEach((argument, index) => {
    const previous = args[index - 1]
    if (previous && !previous.includes('=') && isSecretOption(previous)) secrets.push(argument)
    const equalsIndex = argument.indexOf('=')
    if (equalsIndex >= 0 && isSecretOption(argument)) secrets.push(argument.slice(equalsIndex + 1))
  })

  let redacted = text
  for (const secret of [...new Set(secrets)].filter(Boolean).sort((left, right) => right.length - left.length)) {
    redacted = redacted.split(secret).join(REDACTED)
  }
  return redacted.replace(/(\b[a-z][a-z\d+.-]*:\/\/[^\s/:@]+:)[^\s/@]+@/gi, `$1${REDACTED}@`)
}
