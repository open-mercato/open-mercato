import type { AwilixContainer } from 'awilix'
import {
  AiModerationBlockedError,
  AiModerationUnavailableError,
  type ModerationCategoryResult,
} from './moderation'

export type AiContentSafetyPhase = 'input' | 'output' | 'tool_result'

export type AiContentSafetyRule =
  | 'prompt_injection'
  | 'tool_redirection'
  | 'data_poisoning'
  | 'model_inversion'
  | 'credential_exfiltration'

export type AiContentSafetyFinding = {
  rule: AiContentSafetyRule
  severity: 'block'
}

export type AiContentSafetyResult = {
  allowed: boolean
  findings: AiContentSafetyFinding[]
}

export type AiContentSafetyCheck = {
  phase: AiContentSafetyPhase
  content: unknown
}

export interface AiContentSafetyService {
  scan(input: AiContentSafetyCheck): Promise<AiContentSafetyResult>
}

const MAX_SCAN_CHARS = 200_000

const RULE_PATTERNS: ReadonlyArray<{
  rule: AiContentSafetyRule
  patterns: readonly RegExp[]
}> = [
  {
    rule: 'prompt_injection',
    patterns: [
      /\b(ignore|disregard|forget|override|bypass)\b[^.!?\n]{0,80}\b(previous|prior|above|system|developer|prompt|instruction|instructions|guardrail|guardrails)\b/i,
      /\b(new system prompt|you are now the system|act as root|act as administrator)\b/i,
    ],
  },
  {
    rule: 'tool_redirection',
    patterns: [
      /\b(call|invoke|execute|run|trigger)\b[^.!?\n]{0,60}\b(tool|function|command|endpoint)\b[^.!?\n]{0,80}\b(instead|regardless|without approval|without confirmation)\b/i,
      /\b(approve|pay\s?out|payout|transfer|refund|wire|delete|disburse)\b[^.!?\n]{0,80}\b(without approval|without confirmation|immediately)\b/i,
    ],
  },
  {
    rule: 'data_poisoning',
    patterns: [
      /\b(treat|mark|store|insert|replace|promote)\b[^.!?\n]{0,80}\b(trusted ground truth|authoritative source|training data|validated record|validated records)\b/i,
      /\b(poison|corrupt|contaminate)\b[^.!?\n]{0,80}\b(training|retrieval|rag|dataset|knowledge base|index)\b/i,
    ],
  },
  {
    rule: 'model_inversion',
    patterns: [
      /\b(reconstruct|extract|recover|dump|reveal)\b[^.!?\n]{0,100}\b(memorized|training data|private context|hidden context|system prompt|developer prompt)\b/i,
      /\b(repeat|return|print)\b[^.!?\n]{0,80}\b(verbatim hidden|verbatim private|internal prompt|secret prompt)\b/i,
    ],
  },
  {
    rule: 'credential_exfiltration',
    patterns: [
      /\b(exfiltrate|leak|send|upload|reveal|print|return)\b[^.!?\n]{0,80}\b(api key|password|private key|access token|refresh token|credential|credentials)\b/i,
    ],
  },
]

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content.slice(0, MAX_SCAN_CHARS)
  try {
    return JSON.stringify(content).slice(0, MAX_SCAN_CHARS)
  } catch {
    return String(content).slice(0, MAX_SCAN_CHARS)
  }
}

export function scanAiContentSafety(input: AiContentSafetyCheck): AiContentSafetyResult {
  const text = contentToText(input.content)
  const findings = RULE_PATTERNS
    .filter(({ patterns }) => patterns.some((pattern) => pattern.test(text)))
    .map(({ rule }) => ({ rule, severity: 'block' as const }))
  return { allowed: findings.length === 0, findings }
}

export function createContentSafetyService(): AiContentSafetyService {
  return {
    async scan(input) {
      return scanAiContentSafety(input)
    },
  }
}

function categoriesFromFindings(
  findings: AiContentSafetyFinding[],
): Record<string, ModerationCategoryResult> {
  return Object.fromEntries(
    findings.map((finding) => [finding.rule, { flagged: true, score: 1 }]),
  )
}

export class AiContentSafetyBlockedError extends AiModerationBlockedError {
  readonly phase: AiContentSafetyPhase
  readonly findings: AiContentSafetyFinding[]

  constructor(phase: AiContentSafetyPhase, findings: AiContentSafetyFinding[]) {
    super(categoriesFromFindings(findings))
    this.name = 'AiContentSafetyBlockedError'
    this.phase = phase
    this.findings = findings
  }
}

export class AiContentSafetyUnavailableError extends AiModerationUnavailableError {
  constructor(cause?: unknown) {
    super('provider-independent content safety service failed', cause)
    this.name = 'AiContentSafetyUnavailableError'
  }
}

export async function enforceAiContentSafety(
  container: AwilixContainer | undefined,
  input: AiContentSafetyCheck,
): Promise<void> {
  let service: AiContentSafetyService = createContentSafetyService()
  if (container) {
    try {
      service = container.resolve<AiContentSafetyService>('contentSafetyService')
    } catch {
      service = createContentSafetyService()
    }
  }

  let result: AiContentSafetyResult
  try {
    result = await service.scan(input)
  } catch (error) {
    throw new AiContentSafetyUnavailableError(error)
  }
  if (!result.allowed) throw new AiContentSafetyBlockedError(input.phase, result.findings)
}
