export const REVIEW_ASSISTANT_AGENT_ID = 'documents.review_assistant'

export const REVIEW_ASSISTANT_TOOL_NAMES = {
  listFindings: 'documents.list_review_findings',
  getFinding: 'documents.get_review_finding',
  getReference: 'documents.get_review_reference',
  applyFinding: 'documents.apply_finding',
  keepFinding: 'documents.keep_finding',
  reopenFinding: 'documents.reopen_finding',
} as const

export const REVIEW_ASSISTANT_MUTATION_TOOL_NAMES: readonly string[] = [
  REVIEW_ASSISTANT_TOOL_NAMES.applyFinding,
  REVIEW_ASSISTANT_TOOL_NAMES.keepFinding,
  REVIEW_ASSISTANT_TOOL_NAMES.reopenFinding,
]
