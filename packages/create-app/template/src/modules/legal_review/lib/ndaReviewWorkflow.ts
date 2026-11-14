import {
  AGENT_PROPOSAL_READY_SIGNAL,
  DOCUMENT_FINDING_INGEST_COMMAND_ID,
  DOCUMENTS_REVIEW_CLEARED_SIGNAL,
  LEGAL_MATTER_RELEASE_COMMAND_ID,
  NDA_REVIEW_WORKFLOW_ID,
  NDA_REVIEWER_AGENT_ID,
} from './constants'

/**
 * Correlation key a run of the NDA review workflow MUST be started with, so the
 * `documents.review.cleared` subscriber can find the run parked on the
 * clearance wait for the same document.
 */
export function buildNdaReviewCorrelationKey(documentId: string): string {
  return `legal_review:${documentId}`
}

/**
 * The commands the NDA review workflow runs through UPDATE_ENTITY. Both are
 * new workflow-safe candidates without `defaultEnabled`, so a tenant must
 * switch them on in the workflow command policy (the example seed does it).
 */
export const NDA_REVIEW_WORKFLOW_COMMAND_IDS = [
  DOCUMENT_FINDING_INGEST_COMMAND_ID,
  LEGAL_MATTER_RELEASE_COMMAND_ID,
] as const

/**
 * Example NDA review workflow (spec "Consumer Guidance"):
 *
 *   START → INVOKE_AGENT legal_review.nda_reviewer
 *     ─ researcher ─▶ (UPDATE_ENTITY documents.finding.ingest) WAIT_FOR_SIGNAL documents_review_cleared
 *     ─ error / guardrailBlocked ─▶ USER_TASK manual review
 *   → UPDATE_ENTITY legal_review.matter.release → END
 *
 * `findings` is the whole value `{{context.review.findings}}` so interpolation
 * keeps the array type (R11 spike, proven by TC-DOC-AGENT-001).
 */
export function buildNdaReviewWorkflowSeed() {
  return {
    workflowId: NDA_REVIEW_WORKFLOW_ID,
    workflowName: 'NDA review (AI findings)',
    description:
      'Runs the legal_review.nda_reviewer agent on a document, stores its findings in Documents, waits until no blocking finding is open, then releases the legal matter. Start each run with the correlation key "legal_review:<documentId>".',
    version: 1,
    enabled: true,
    metadata: {
      category: 'Legal',
      tags: ['legal', 'nda', 'documents', 'agent'],
      icon: 'scale',
    },
    definition: {
      contextSchema: {
        input: {
          fields: [
            { name: 'documentId', type: 'text' as const, label: 'Document ID', required: true },
            { name: 'matterId', type: 'text' as const, label: 'Legal matter ID', required: true },
            { name: 'playbookCode', type: 'text' as const, label: 'Playbook code' },
          ],
        },
      },
      steps: [
        { stepId: 'start', stepName: 'Review requested', stepType: 'START' },
        {
          stepId: 'ai_review',
          stepName: 'AI review against the playbook',
          stepType: 'AUTOMATED',
          description: 'Runs the NDA reviewer agent. It returns findings only and never edits the document.',
          signalConfig: { signalName: AGENT_PROPOSAL_READY_SIGNAL },
          activities: [
            {
              activityId: 'invoke_nda_reviewer',
              activityName: 'Review NDA with AI',
              activityType: 'INVOKE_AGENT',
              config: {
                agentId: NDA_REVIEWER_AGENT_ID,
                input: {
                  documentId: '{{context.documentId}}',
                  playbookCode: '{{context.playbookCode}}',
                },
                onResult: { alwaysAsk: true },
                outputMapping: { review: 'data' },
              },
            },
          ],
        },
        {
          stepId: 'await_clearance',
          stepName: 'Lawyer clears blocking findings',
          stepType: 'WAIT_FOR_SIGNAL',
          description: 'Parks until the documents.review.cleared subscriber sends documents_review_cleared.',
          signalConfig: { signalName: DOCUMENTS_REVIEW_CLEARED_SIGNAL },
        },
        {
          stepId: 'manual_review',
          stepName: 'Manual review',
          stepType: 'USER_TASK',
          description: 'The agent failed or was blocked by a guardrail: a lawyer reviews the document by hand.',
          userTaskConfig: {
            assignedToRoles: ['admin'],
            formSchema: {
              fields: [{ name: 'notes', type: 'text', label: 'Review notes' }],
            },
          },
        },
        {
          stepId: 'release',
          stepName: 'Release the matter',
          stepType: 'AUTOMATED',
          activities: [
            {
              activityId: 'release_matter',
              activityName: 'Advance the matter to released',
              activityType: 'UPDATE_ENTITY',
              config: {
                commandId: LEGAL_MATTER_RELEASE_COMMAND_ID,
                input: { matterId: '{{context.matterId}}' },
              },
            },
          ],
        },
        { stepId: 'end', stepName: 'Released', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 'start-to-review', fromStepId: 'start', toStepId: 'ai_review', trigger: 'auto', priority: 100 },
        {
          transitionId: 'review-researched',
          transitionName: 'Store findings',
          fromStepId: 'ai_review',
          toStepId: 'await_clearance',
          trigger: 'auto',
          priority: 100,
          kind: 'outcome',
          outcomeKind: 'researcher',
          continueOnActivityFailure: false,
          activities: [
            {
              activityId: 'ingest_findings',
              activityName: 'Store review findings',
              activityType: 'UPDATE_ENTITY',
              async: false,
              config: {
                commandId: DOCUMENT_FINDING_INGEST_COMMAND_ID,
                input: {
                  documentId: '{{context.documentId}}',
                  playbookCode: '{{context.playbookCode}}',
                  findings: '{{context.review.findings}}',
                  source: 'ai',
                  origin: { workflowInstanceId: '{{workflow.instanceId}}' },
                },
              },
            },
          ],
        },
        {
          transitionId: 'review-error',
          transitionName: 'Agent failed',
          fromStepId: 'ai_review',
          toStepId: 'manual_review',
          trigger: 'auto',
          priority: 90,
          kind: 'outcome',
          outcomeKind: 'error',
        },
        {
          transitionId: 'review-guardrail',
          transitionName: 'Guardrail blocked',
          fromStepId: 'ai_review',
          toStepId: 'manual_review',
          trigger: 'auto',
          priority: 80,
          kind: 'outcome',
          outcomeKind: 'guardrailBlocked',
        },
        { transitionId: 'cleared-to-release', fromStepId: 'await_clearance', toStepId: 'release', trigger: 'auto', priority: 100 },
        { transitionId: 'manual-to-release', fromStepId: 'manual_review', toStepId: 'release', trigger: 'manual', priority: 100 },
        { transitionId: 'release-to-end', fromStepId: 'release', toStepId: 'end', trigger: 'auto', priority: 100 },
      ],
    },
  }
}
