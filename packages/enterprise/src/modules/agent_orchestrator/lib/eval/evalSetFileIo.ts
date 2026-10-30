import fs from 'node:fs'
import path from 'node:path'
import {
  EVAL_SET_FILE_ISSUE,
  type EvalSetFile,
  type EvalSetFileIssue,
  type EvalSetFileValidation,
} from './evalSetFile'
import { validateEvalSetText, type EvalSetTextFormat } from './evalSetYaml'
import { resolveEvalSetMaxBytes } from './manifest'
import { getScorerDefinition } from './registry'

export const EVAL_SET_FILE_EXTENSIONS: Readonly<Record<string, EvalSetTextFormat>> = {
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
}

export type EvalSetFileRead =
  | { ok: true; file: EvalSetFile; format: EvalSetTextFormat; resolvedPath: string }
  | { ok: false; issues: EvalSetFileIssue[]; resolvedPath: string }

export function evalSetFormatFromPath(filePath: string): EvalSetTextFormat | null {
  return EVAL_SET_FILE_EXTENSIONS[path.extname(filePath).toLowerCase()] ?? null
}

function readFailure(resolvedPath: string, message: string, code: EvalSetFileIssue['code'] = EVAL_SET_FILE_ISSUE.invalidFormat): EvalSetFileRead {
  return { ok: false, resolvedPath, issues: [{ code, path: '', message }] }
}

function readBounded(fd: number, maxBytes: number): Buffer | null {
  const buffer = Buffer.alloc(maxBytes + 1)
  let total = 0
  while (total < buffer.length) {
    const read = fs.readSync(fd, buffer, total, buffer.length - total, null)
    if (read === 0) break
    total += read
  }
  return total > maxBytes ? null : buffer.subarray(0, total)
}

/**
 * Reads an eval-set file from disk for the CLI. The path resolves against
 * `cwd`, the format comes from the extension (`.json`, `.yaml`, `.yml`), only
 * regular files are accepted and the byte cap (`OM_AGENT_EVAL_SET_MAX_BYTES`)
 * is enforced before the content is read in full.
 */
export function readEvalSetFile(
  filePath: string,
  options: { cwd?: string; maxBytes?: number } = {},
): EvalSetFileRead {
  const resolvedPath = path.resolve(options.cwd ?? process.cwd(), filePath)
  const format = evalSetFormatFromPath(resolvedPath)
  if (!format) {
    return readFailure(resolvedPath, `unsupported file extension: use ${Object.keys(EVAL_SET_FILE_EXTENSIONS).join(', ')}`)
  }
  const maxBytes = options.maxBytes ?? resolveEvalSetMaxBytes()
  let fd: number | null = null
  try {
    fd = fs.openSync(resolvedPath, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0))
    const stats = fs.fstatSync(fd)
    if (!stats.isFile()) return readFailure(resolvedPath, 'not a regular file')
    const tooLarge = `file is above the ${maxBytes}-byte limit (OM_AGENT_EVAL_SET_MAX_BYTES)`
    if (stats.size > maxBytes) return readFailure(resolvedPath, tooLarge, EVAL_SET_FILE_ISSUE.tooLarge)
    const content = readBounded(fd, maxBytes)
    if (!content) return readFailure(resolvedPath, tooLarge, EVAL_SET_FILE_ISSUE.tooLarge)
    const validation: EvalSetFileValidation = validateEvalSetText(content.toString('utf8'), { format, maxBytes })
    return validation.ok
      ? { ok: true, file: validation.file, format, resolvedPath }
      : { ok: false, issues: validation.issues, resolvedPath }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : null
    return readFailure(resolvedPath, code === 'ENOENT' ? 'file not found' : `cannot read file${code ? ` (${code})` : ''}`)
  } finally {
    if (fd !== null) fs.closeSync(fd)
  }
}

export function formatEvalSetFileIssues(issues: ReadonlyArray<EvalSetFileIssue>): string[] {
  return issues.map((issue) => `  [${issue.code}] ${issue.path || '.'}: ${issue.message}`)
}

/**
 * The file format refuses `gate` on `llm_judge` assertions (a judge verdict is
 * stochastic and must never block a release), but database rows created before
 * that invariant may still carry it. Export downgrades those assertions to
 * `warn` and returns their keys so the caller can say so.
 */
export function downgradeJudgeGateAssertions(file: EvalSetFile): { file: EvalSetFile; downgradedKeys: string[] } {
  const downgradedKeys: string[] = []
  const assertions = file.assertions.map((assertion) => {
    const kind = getScorerDefinition(assertion.scorerKey)?.kind ?? assertion.type
    if (kind !== 'llm_judge' || assertion.severity !== 'gate') return assertion
    downgradedKeys.push(assertion.key)
    return { ...assertion, severity: 'warn' as const }
  })
  return downgradedKeys.length > 0 ? { file: { ...file, assertions }, downgradedKeys } : { file, downgradedKeys }
}
