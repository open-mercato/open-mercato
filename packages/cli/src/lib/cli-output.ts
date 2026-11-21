const SECRET_OPTION_PATTERN = /(?:password|passwd|passphrase|secret|token|credentials?|authorization|bearer|(?:api|private|signing|encryption(?:fallback)?|access|client)key|databaseurl|redisurl|connectionstring)(?:v\d+)?$/i
const REDACTED = '****'

function isSecretName(name: string): boolean {
  return SECRET_OPTION_PATTERN.test(name.replace(/[-_]/g, ''))
}

function isSecretOption(argument: string, additionalSecretOptions: ReadonlySet<string>): boolean {
  const option = argument.split('=', 1)[0]
  return argument.startsWith('-') && (isSecretName(option) || additionalSecretOptions.has(option))
}

export function redactCliArgs(args: string[], additionalSecretOptions: ReadonlySet<string> = new Set()): string[] {
  return args.map((argument, index) => {
    const previous = args[index - 1]
    if (previous && !previous.includes('=') && isSecretOption(previous, additionalSecretOptions)) return REDACTED
    const equalsIndex = argument.indexOf('=')
    if (equalsIndex >= 0 && isSecretOption(argument, additionalSecretOptions)) {
      return `${argument.slice(0, equalsIndex + 1)}${REDACTED}`
    }
    return argument
  })
}

export function redactCliText(
  text: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  additionalSecretOptions: ReadonlySet<string> = new Set(),
): string {
  const secrets = Object.entries(env)
    .filter(([name, value]) => isSecretName(name) && Boolean(value))
    .map(([, value]) => value as string)

  args.forEach((argument, index) => {
    const previous = args[index - 1]
    if (previous && !previous.includes('=') && isSecretOption(previous, additionalSecretOptions)) secrets.push(argument)
    const equalsIndex = argument.indexOf('=')
    if (equalsIndex >= 0 && isSecretOption(argument, additionalSecretOptions)) secrets.push(argument.slice(equalsIndex + 1))
  })

  let redacted = text
  for (const secret of [...new Set(secrets)].filter(Boolean).sort((left, right) => right.length - left.length)) {
    redacted = redacted.split(secret).join(REDACTED)
  }
  return redacted.replace(/(\b[a-z][a-z\d+.-]*:\/\/[^\s/:@]*:)[^\s/@]+@/gi, `$1${REDACTED}@`)
}
