import type { z } from 'zod'

export type DefinitionValidationIssue = {
  path: Array<string | number>
  code: string
  message: string
  expected?: string
  got?: string
}

const RECEIVED_MESSAGE_PATTERN = /received (.+)$/

function normalizeIssuePath(path: ReadonlyArray<PropertyKey>): Array<string | number> {
  return path.map((segment) => (typeof segment === 'number' ? segment : String(segment)))
}

function resolveExpected(issue: z.core.$ZodIssue): string | undefined {
  if ('expected' in issue && typeof issue.expected === 'string') return issue.expected
  if ('values' in issue && Array.isArray(issue.values)) {
    return issue.values.map((value) => JSON.stringify(value)).join(' | ')
  }
  return undefined
}

function resolveGot(issue: z.core.$ZodIssue): string | undefined {
  if (issue.code !== 'invalid_type') return undefined
  const match = RECEIVED_MESSAGE_PATTERN.exec(issue.message)
  return match ? match[1] : undefined
}

export function normalizeDefinitionValidationIssues(error: z.ZodError): DefinitionValidationIssue[] {
  return error.issues.map((issue) => {
    const expected = resolveExpected(issue)
    const got = resolveGot(issue)
    return {
      path: normalizeIssuePath(issue.path),
      code: typeof issue.code === 'string' ? issue.code : 'custom',
      message: issue.message,
      ...(expected !== undefined ? { expected } : {}),
      ...(got !== undefined ? { got } : {}),
    }
  })
}
