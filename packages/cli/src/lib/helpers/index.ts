/**
 * CLI Helpers - Centralized utilities for Open Mercato CLI
 * 
 * This module provides centralized CLI helper functions that replace
 * scattered implementations across individual module CLI files.
 * 
 * @example
 * ```ts
 * import { parseCliArgs, cliLogger, validateRequiredArgs } from '@open-mercato/cli/lib/helpers'
 * ```
 */

// Argument parsing
export {
  parseCliArgs,
  parseArgs,
  buildUsage,
  validateRequiredArgs,
  type ParsedArgs,
  type ParseArgsOptions,
  type ParseArgsResult,
} from './args.js'

// Logging
export {
  cliLogger,
  logger,
  log,
  debug,
  info,
  warn,
  error,
  success,
  logInfo,
  logError,
  logSuccess,
  type LogLevel,
  type LoggerOptions,
} from './logger.js'
