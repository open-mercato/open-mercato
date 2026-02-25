/**
 * CLI Logger Utilities
 * 
 * Centralized logging for CLI commands with consistent formatting,
 * log levels, and color support.
 * 
 * @example
 * ```ts
 * import { cliLogger } from '@open-mercato/cli/lib/helpers'
 * 
 * cliLogger.info('Processing...')
 * cliLogger.success('Done!')
 * cliLogger.error('Failed:', err.message)
 * ```
 */

import { format } from 'util'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success'

export interface LoggerOptions {
  /** Minimum log level to display */
  level?: LogLevel
  /** Enable/disable colors */
  colors?: boolean
  /** Enable/disable timestamps */
  timestamps?: boolean
  /** Custom prefix for all messages */
  prefix?: string
  /** Output stream (default: process.stderr for errors, process.stdout for others) */
  output?: NodeJS.WriteStream
}

// ANSI color codes
const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
}

// Log level weights for filtering
const LEVEL_WEIGHTS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  success: 1,
}

// Icons for log levels
const LEVEL_ICONS: Record<LogLevel, string> = {
  debug: '🔍',
  info: 'ℹ️ ',
  warn: '⚠️ ',
  error: '❌',
  success: '✅',
}

// Colors for log levels
const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: COLORS.dim,
  info: COLORS.blue,
  warn: COLORS.yellow,
  error: COLORS.red,
  success: COLORS.green,
}

class CliLogger {
  private options: Required<LoggerOptions>

  constructor(options: LoggerOptions = {}) {
    this.options = {
      level: options.level ?? 'info',
      colors: options.colors ?? true,
      timestamps: options.timestamps ?? false,
      prefix: options.prefix ?? '',
      output: options.output ?? process.stdout,
    }
  }

  /**
   * Configure logger options
   */
  configure(options: Partial<LoggerOptions>): void {
    this.options = { ...this.options, ...options }
  }

  /**
   * Check if a log level should be displayed
   */
  private shouldLog(level: LogLevel): boolean {
    return LEVEL_WEIGHTS[level] >= LEVEL_WEIGHTS[this.options.level]
  }

  /**
   * Format a log message
   */
  private format(level: LogLevel, message: string): string {
    const parts: string[] = []

    // Timestamp
    if (this.options.timestamps) {
      const now = new Date()
      const ts = `${COLORS.dim}[${now.toISOString()}]${COLORS.reset}`
      parts.push(ts)
    }

    // Icon and level
    const icon = LEVEL_ICONS[level]
    const color = this.options.colors ? LEVEL_COLORS[level] : ''
    const reset = this.options.colors ? COLORS.reset : ''
    parts.push(`${color}${icon}${reset}`)

    // Prefix
    if (this.options.prefix) {
      parts.push(`[${this.options.prefix}]`)
    }

    // Message
    parts.push(message)

    return parts.join(' ')
  }

  /**
   * Write to output
   */
  private write(level: LogLevel, message: string): void {
    if (!this.shouldLog(level)) return

    const formatted = this.format(level, message)
    const output = level === 'error' ? process.stderr : this.options.output
    output.write(formatted + '\n')
  }

  /**
   * Log a debug message
   */
  debug(message: string, ...args: unknown[]): void {
    this.write('debug', format(message, ...args))
  }

  /**
   * Log an info message
   */
  info(message: string, ...args: unknown[]): void {
    this.write('info', format(message, ...args))
  }

  /**
   * Log a warning message
   */
  warn(message: string, ...args: unknown[]): void {
    this.write('warn', format(message, ...args))
  }

  /**
   * Log an error message
   */
  error(message: string, ...args: unknown[]): void {
    this.write('error', format(message, ...args))
  }

  /**
   * Log a success message
   */
  success(message: string, ...args: unknown[]): void {
    this.write('success', format(message, ...args))
  }

  /**
   * Create a new logger with a specific prefix
   */
  withPrefix(prefix: string): CliLogger {
    return new CliLogger({
      ...this.options,
      prefix: this.options.prefix ? `${this.options.prefix}:${prefix}` : prefix,
    })
  }

  /**
   * Create a new logger for a specific module
   */
  forModule(module: string): CliLogger {
    return this.withPrefix(module)
  }

  /**
   * Log a section header
   */
  header(title: string): void {
    const line = '═'.repeat(title.length + 4)
    this.info(line)
    this.info(`  ${title}  `)
    this.info(line)
  }

  /**
   * Log a list of items
   */
  list(items: string[], options: { bullet?: string; indent?: number } = {}): void {
    const bullet = options.bullet ?? '  •'
    const indent = ' '.repeat(options.indent ?? 0)
    for (const item of items) {
      this.info(`${indent}${bullet} ${item}`)
    }
  }

  /**
   * Create a spinner for long-running operations
   * Returns a function to stop the spinner
   */
  spinner(message: string): { stop: (finalMessage?: string) => void; fail: (errorMessage: string) => void } {
    const spinnerChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
    let i = 0
    let stopped = false

    const interval = setInterval(() => {
      if (stopped) return
      const char = spinnerChars[i % spinnerChars.length]
      process.stdout.write(`\r${COLORS.cyan}${char}${COLORS.reset} ${message}`)
      i++
    }, 80)

    return {
      stop: (finalMessage?: string) => {
        stopped = true
        clearInterval(interval)
        process.stdout.write('\r')
        if (finalMessage) {
          this.success(finalMessage)
        }
      },
      fail: (errorMessage: string) => {
        stopped = true
        clearInterval(interval)
        process.stdout.write('\r')
        this.error(errorMessage)
      },
    }
  }
}

// Global logger instance
export const cliLogger = new CliLogger()

// Convenience exports
export const logger = cliLogger
export const log = cliLogger.info.bind(cliLogger)
export const debug = cliLogger.debug.bind(cliLogger)
export const info = cliLogger.info.bind(cliLogger)
export const warn = cliLogger.warn.bind(cliLogger)
export const error = cliLogger.error.bind(cliLogger)
export const success = cliLogger.success.bind(cliLogger)

// Legacy console wrappers for backward compatibility
/**
 * @deprecated Use cliLogger.info instead
 */
export function logInfo(message: string, ...args: unknown[]): void {
  cliLogger.info(message, ...args)
}

/**
 * @deprecated Use cliLogger.error instead
 */
export function logError(message: string, ...args: unknown[]): void {
  cliLogger.error(message, ...args)
}

/**
 * @deprecated Use cliLogger.success instead
 */
export function logSuccess(message: string, ...args: unknown[]): void {
  cliLogger.success(message, ...args)
}
