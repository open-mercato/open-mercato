/**
 * CLI Argument Parsing Utilities
 * 
 * Centralized argument parsing for CLI commands across Open Mercato modules.
 * Replaces scattered parseArgs implementations in individual CLI modules.
 * 
 * @example
 * ```ts
 * import { parseCliArgs } from '@open-mercato/cli/lib/helpers'
 * 
 * const args = parseCliArgs(rest, {
 *   string: ['org', 'tenant'],
 *   boolean: ['force', 'verbose'],
 *   required: ['org', 'tenant']
 * })
 * ```
 */

export type ParsedArgs = Record<string, string | boolean | string[]>

export interface ParseArgsOptions {
  /** Keys that should be parsed as strings */
  string?: string[]
  /** Keys that should be parsed as booleans */
  boolean?: string[]
  /** Keys that should be parsed as arrays (can be specified multiple times) */
  array?: string[]
  /** Required keys that must be present */
  required?: string[]
  /** Aliases for keys (e.g., { o: 'org' }) */
  alias?: Record<string, string>
  /** Default values */
  default?: Record<string, string | boolean | string[]>
}

export interface ParseArgsResult {
  /** Parsed arguments */
  args: ParsedArgs
  /** Positional arguments (non-flag values) */
  positional: string[]
  /** Missing required keys */
  missing: string[]
}

/**
 * Parse CLI arguments from process.argv-like array
 * 
 * Supports:
 * - Long flags: --name=value, --name value, --flag
 * - Short flags: -n value, -abc (combined booleans)
 * - Positional arguments
 * - Type coercion (string, boolean, array)
 * - Required field validation
 * - Default values
 */
export function parseCliArgs(
  argv: string[],
  options: ParseArgsOptions = {}
): ParseArgsResult {
  const args: ParsedArgs = { ...options.default }
  const positional: string[] = []
  const missing: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg) continue

    // Handle long flags: --name or --name=value
    if (arg.startsWith('--')) {
      const longArg = arg.slice(2)
      const equalIndex = longArg.indexOf('=')

      if (equalIndex !== -1) {
        // --name=value format
        const key = longArg.slice(0, equalIndex)
        const value = longArg.slice(equalIndex + 1)
        setArgValue(args, key, value, options)
      } else {
        // --name [value] format or --flag
        const key = longArg
        const nextArg = argv[i + 1]

        if (options.boolean?.includes(key)) {
          // Boolean flag
          args[key] = true
        } else if (nextArg && !nextArg.startsWith('-')) {
          // Has value
          setArgValue(args, key, nextArg, options)
          i++ // Skip next arg
        } else {
          // Treat as boolean if no value provided
          args[key] = true
        }
      }
      continue
    }

    // Handle short flags: -n or -abc
    if (arg.startsWith('-') && arg.length > 1) {
      const shortFlags = arg.slice(1)

      for (let j = 0; j < shortFlags.length; j++) {
        const shortFlag = shortFlags[j]
        const key = options.alias?.[shortFlag] || shortFlag

        if (j === shortFlags.length - 1) {
          // Last short flag can have a value
          const nextArg = argv[i + 1]
          if (nextArg && !nextArg.startsWith('-') && !options.boolean?.includes(key)) {
            setArgValue(args, key, nextArg, options)
            i++ // Skip next arg
          } else {
            args[key] = true
          }
        } else {
          // Combined boolean flags: -abc
          args[key] = true
        }
      }
      continue
    }

    // Positional argument
    positional.push(arg)
  }

  // Check required fields
  if (options.required) {
    for (const key of options.required) {
      if (args[key] === undefined) {
        missing.push(key)
      }
    }
  }

  return { args, positional, missing }
}

function setArgValue(
  args: ParsedArgs,
  key: string,
  value: string,
  options: ParseArgsOptions
): void {
  if (options.array?.includes(key)) {
    // Array type - append to existing or create new
    const existing = args[key]
    if (Array.isArray(existing)) {
      existing.push(value)
    } else {
      args[key] = [value]
    }
  } else {
    // String or boolean
    args[key] = value
  }
}

/**
 * Legacy parseArgs function for backward compatibility
 * @deprecated Use parseCliArgs instead
 */
export function parseArgs(rest: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {}
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (!a) continue
    if (a.startsWith('--')) {
      const [k, v] = a.replace(/^--/, '').split('=')
      if (v !== undefined) args[k] = v
      else if (rest[i + 1] && !rest[i + 1]!.startsWith('--')) {
        args[k] = rest[i + 1]!
        i++
      } else args[k] = true
    }
  }
  return args
}

/**
 * Build usage string from options
 */
export function buildUsage(command: string, options: ParseArgsOptions): string {
  const parts = [command]

  if (options.required) {
    for (const key of options.required) {
      const aliases = Object.entries(options.alias || {})
        .filter(([, v]) => v === key)
        .map(([k]) => `-${k}`)
      const flags = aliases.length > 0 ? aliases.join('|') : `--${key}`
      parts.push(`<${flags} <${key}>>`)
    }
  }

  if (options.string) {
    for (const key of options.string) {
      if (!options.required?.includes(key)) {
        parts.push(`[--${key} <value>]`)
      }
    }
  }

  if (options.boolean) {
    for (const key of options.boolean) {
      parts.push(`[--${key}]`)
    }
  }

  return parts.join(' ')
}

/**
 * Validate that required args are present
 * Returns error message or null if valid
 */
export function validateRequiredArgs(
  args: ParsedArgs,
  required: string[]
): string | null {
  const missing = required.filter(key => args[key] === undefined)
  if (missing.length === 0) return null
  return `Missing required arguments: ${missing.map(r => `--${r}`).join(', ')}`
}
