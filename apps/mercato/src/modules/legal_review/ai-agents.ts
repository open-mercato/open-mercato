import type { AiAgentDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'
import { defineAgent } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/sdk/defineAgent'
import {
  documentReviewOutcomeSchema,
  DOCUMENT_REVIEW_TOOL_IDS,
  buildDocumentReviewInstructions,
} from '@open-mercato/documents/modules/documents/lib/reviewAgentContract'
import { NDA_REVIEWER_AGENT_ID } from './lib/constants'

const NDA_REVIEW_GUIDANCE = [
  'Review the agreement clause by clause, in document order, against every active rule of the playbook.',
  'Quote each passage you report exactly as it appears in the document, from a single block, so it can be located again.',
  "When the rule has preferred wording, propose replacement text built from that wording in `suggestedText`; otherwise leave it out.",
  'Treat confidentiality term, definition of confidential information, permitted disclosures, return or destruction, governing law and non-solicitation as separate clauses even when the document merges them.',
].join('\n')

/**
 * The NDA reviewer is a RESEARCHER agent: it reads the document and the
 * playbook through the two read-only Documents tools and returns findings
 * validated against the Documents review outcome contract. It never edits the
 * document — the workflow persists its findings with the workflow-safe
 * `documents.finding.ingest` command and a lawyer decides each one.
 */
export const aiAgents: AiAgentDefinition[] = [
  defineAgent({
    id: NDA_REVIEWER_AGENT_ID,
    moduleId: 'legal_review',
    label: 'NDA reviewer',
    description: 'Checks an NDA against the firm playbook and returns anchored findings.',
    instructions: buildDocumentReviewInstructions({ extra: NDA_REVIEW_GUIDANCE }),
    tools: [...DOCUMENT_REVIEW_TOOL_IDS],
    result: { kind: 'research', schema: documentReviewOutcomeSchema },
    sampleInput: {
      documentId: '00000000-0000-4000-8000-000000000000',
      playbookCode: 'nda',
    },
  }),
]
