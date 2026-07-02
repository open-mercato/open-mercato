import { z } from 'zod'
import { defineAiAgent } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'
import type {
  AiAgentDefinition,
  AiAgentPageContextInput,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'

type PromptSectionName =
  | 'role'
  | 'scope'
  | 'data'
  | 'tools'
  | 'attachments'
  | 'mutationPolicy'
  | 'responseStyle'

interface PromptSection {
  name: PromptSectionName
  content: string
  order: number
}

interface PromptTemplate {
  id: string
  sections: PromptSection[]
}

const MODULE_ID = 'incidents'
const REQUIRED_FEATURES = ['incidents.incident.view', 'incidents.ai.use'] as const

const INCIDENT_TOOL_IDS = [
  'incidents.list_incidents',
  'incidents.get_incident',
  'incidents.find_similar_incidents',
  'incidents.add_timeline_note',
] as const

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const incidentsTriageOutputSchema = z.object({
  severityKey: z.string(),
  typeKey: z.string(),
  rationale: z.string(),
  possibleDuplicateIds: z.array(z.string()),
})

export type IncidentsTriageOutput = z.infer<typeof incidentsTriageOutputSchema>

export const incidentsPostmortemOutputSchema = z.object({
  summary: z.string(),
  rootCause: z.string(),
  impact: z.string(),
  contributingFactors: z.string(),
  lessons: z.string(),
  actionItems: z.array(z.object({
    title: z.string(),
    description: z.string().optional(),
  })),
})

export type IncidentsPostmortemOutput = z.infer<typeof incidentsPostmortemOutputSchema>

export const incidentsSummaryOutputSchema = z.object({
  summary: z.string(),
  keyEvents: z.array(z.string()),
})

export type IncidentsSummaryOutput = z.infer<typeof incidentsSummaryOutputSchema>

export const incidentsCustomerUpdateOutputSchema = z.object({
  draft: z.string(),
})

export type IncidentsCustomerUpdateOutput = z.infer<typeof incidentsCustomerUpdateOutputSchema>

const assistantPromptSections: PromptSection[] = [
  {
    name: 'role',
    order: 1,
    content: [
      'ROLE',
      'You are the Incidents Assistant inside Open Mercato. You help responders investigate incidents, understand severity and status, plan escalation, summarize impact, and keep timelines useful.',
    ].join('\n'),
  },
  {
    name: 'scope',
    order: 2,
    content: [
      'SCOPE',
      'Stay inside this tenant and organization. Use only incidents data returned by tools. Never invent incidents, incident numbers, severities, statuses, impacts, participants, timelines, or escalation facts.',
      'Always cite incident numbers when referencing incidents. If you only have an id, call incidents.get_incident before answering.',
    ].join('\n'),
  },
  {
    name: 'data',
    order: 3,
    content: [
      'DATA',
      'The platform incident lifecycle is open, investigating, identified, mitigated, resolved, and closed. Incidents have tenant-specific severity and type catalogs, escalation policies, impact records, participants, and append-only timeline entries.',
      'Internal timeline entries are available in the backoffice. Treat them as internal context unless the operator explicitly asks for a customer-facing draft.',
    ].join('\n'),
  },
  {
    name: 'tools',
    order: 4,
    content: [
      'TOOLS',
      'Use incidents.list_incidents for filtered lists, incidents.get_incident for a specific incident by id or number, incidents.find_similar_incidents for related history, and incidents.add_timeline_note when the operator asks to add a note.',
      'Suggest tool use proactively instead of guessing. Stop after two unsuccessful searches and say what was searched.',
    ].join('\n'),
  },
  {
    name: 'attachments',
    order: 5,
    content: [
      'ATTACHMENTS',
      'This assistant is focused on incident records and does not need attachments by default.',
    ].join('\n'),
  },
  {
    name: 'mutationPolicy',
    order: 6,
    content: [
      'MUTATION POLICY',
      'The only write tool is incidents.add_timeline_note. It is approval-gated by the platform mutation flow and does not persist until the operator confirms the pending action card.',
      'Never claim a note was saved until the mutation result arrives. For any other write, point the operator to the incident backoffice page.',
    ].join('\n'),
  },
  {
    name: 'responseStyle',
    order: 7,
    content: [
      'RESPONSE STYLE',
      'Be concise and operational. Lead with the answer, cite incident numbers, and separate known facts from recommendations. If data is missing, name the missing tool result rather than filling gaps.',
    ].join('\n'),
  },
]

export const assistantPromptTemplate: PromptTemplate = {
  id: 'incidents.assistant.prompt',
  sections: assistantPromptSections,
}

function compilePromptTemplate(template: PromptTemplate): string {
  return template.sections
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((section) => section.content.trim())
    .join('\n\n')
}

async function resolvePageContext(input: AiAgentPageContextInput): Promise<string | null> {
  const entityType = input.entityType.trim().toLowerCase()
  const isIncidentEntity = entityType === 'incident' || entityType === 'incidents.incident' || entityType === 'incidents:incident'
  if (!isIncidentEntity) return null
  if (!UUID_REGEX.test(input.recordId)) return null
  return [
    '## Page context - incident war room',
    `Current incident id: ${input.recordId}`,
    'Call incidents.get_incident with this id before answering incident-specific questions so responses cite the incident number.',
  ].join('\n')
}

const assistantAgent = defineAiAgent({
  id: 'incidents.assistant',
  moduleId: MODULE_ID,
  label: 'Incident Assistant',
  description:
    'War-room assistant for incident responders. Reads incidents, finds related history, and can stage timeline notes for approval.',
  systemPrompt: compilePromptTemplate(assistantPromptTemplate),
  allowedTools: [...INCIDENT_TOOL_IDS],
  executionMode: 'chat',
  requiredFeatures: [...REQUIRED_FEATURES],
  readOnly: false,
  mutationPolicy: 'confirm-required',
  taskPlan: { enabled: true },
  keywords: ['incidents', 'war room', 'triage', 'escalation', 'postmortem'],
  domain: MODULE_ID,
  dataCapabilities: {
    entities: [
      'incidents.incident',
      'incidents.timeline_entry',
      'incidents.impact',
      'incidents.participant',
    ],
    operations: ['read', 'search'],
  },
  suggestions: [
    {
      label: 'Summarize this incident',
      prompt: 'Summarize the current incident and cite the incident number.',
    },
    {
      label: 'Find related incidents',
      prompt: 'Find similar incidents and explain why they may be related.',
    },
  ],
  resolvePageContext,
})

const triageAgent = defineAiAgent({
  id: 'incidents.triage',
  moduleId: MODULE_ID,
  label: 'Incident Triage',
  description: 'Suggests incident severity and type from a title, description, catalogs, and similar incidents.',
  systemPrompt: [
    'You are an incident triage classifier for Open Mercato.',
    'Given a title, optional description, the provided severity and type catalogs, and similar-incident summaries, return the best severityKey and typeKey.',
    'Use only keys present in the provided catalogs. Include a one-sentence rationale. Include possibleDuplicateIds only when similar incidents are strong matches.',
  ].join('\n'),
  allowedTools: [],
  executionMode: 'object',
  output: {
    schemaName: 'IncidentsTriageSuggestion',
    schema: incidentsTriageOutputSchema,
  },
  requiredFeatures: [...REQUIRED_FEATURES],
  readOnly: true,
  mutationPolicy: 'read-only',
  keywords: ['incidents', 'triage', 'severity', 'type'],
  domain: MODULE_ID,
  dataCapabilities: {
    entities: ['incidents.incident'],
    operations: ['read', 'search'],
  },
})

const postmortemWriterAgent = defineAiAgent({
  id: 'incidents.postmortem_writer',
  moduleId: MODULE_ID,
  label: 'Postmortem Writer',
  description: 'Drafts a structured postmortem from an incident and its timeline for human review.',
  systemPrompt: [
    'You are an incident postmortem drafting assistant for Open Mercato.',
    'Use the provided incident, impacts, participants, and complete timeline. Do not invent root causes or impact not supported by the input.',
    'Draft concise fields that a human responder can edit and save through the existing postmortem form.',
  ].join('\n'),
  allowedTools: [],
  executionMode: 'object',
  output: {
    schemaName: 'IncidentsPostmortemDraft',
    schema: incidentsPostmortemOutputSchema,
  },
  requiredFeatures: [...REQUIRED_FEATURES],
  readOnly: true,
  mutationPolicy: 'read-only',
  keywords: ['incidents', 'postmortem', 'root cause', 'lessons'],
  domain: MODULE_ID,
  dataCapabilities: {
    entities: ['incidents.incident', 'incidents.timeline_entry', 'incidents.impact'],
    operations: ['read'],
  },
})

const summarizerAgent = defineAiAgent({
  id: 'incidents.summarizer',
  moduleId: MODULE_ID,
  label: 'Incident Summarizer',
  description: 'Creates a living summary and key-event list from an incident timeline.',
  systemPrompt: [
    'You are an incident summarizer for Open Mercato.',
    'Use only the provided incident and timeline. Return a concise current-state summary and key events in chronological order.',
    'Do not invent timestamps, actors, impacts, statuses, or incident numbers.',
  ].join('\n'),
  allowedTools: [],
  executionMode: 'object',
  output: {
    schemaName: 'IncidentsLivingSummary',
    schema: incidentsSummaryOutputSchema,
  },
  requiredFeatures: [...REQUIRED_FEATURES],
  readOnly: true,
  mutationPolicy: 'read-only',
  keywords: ['incidents', 'summary', 'timeline'],
  domain: MODULE_ID,
  dataCapabilities: {
    entities: ['incidents.incident', 'incidents.timeline_entry'],
    operations: ['read'],
  },
})

const customerUpdateWriterAgent = defineAiAgent({
  id: 'incidents.customer_update_writer',
  moduleId: MODULE_ID,
  label: 'Customer Update Writer',
  description: 'Drafts customer-facing incident updates without persisting them.',
  systemPrompt: [
    'You are a customer-update drafting assistant for Open Mercato incidents.',
    'Use the provided incident and timeline only as context. The output must be customer-facing, calm, accurate, and free of internal-only details.',
    'Do not expose internal notes, internal participant details, root-cause speculation, raw ids, or unsupported timelines. Return one draft string.',
  ].join('\n'),
  allowedTools: [],
  executionMode: 'object',
  output: {
    schemaName: 'IncidentsCustomerUpdateDraft',
    schema: incidentsCustomerUpdateOutputSchema,
  },
  requiredFeatures: [...REQUIRED_FEATURES],
  readOnly: true,
  mutationPolicy: 'read-only',
  keywords: ['incidents', 'customer update', 'draft'],
  domain: MODULE_ID,
  dataCapabilities: {
    entities: ['incidents.incident', 'incidents.timeline_entry'],
    operations: ['read'],
  },
})

export const aiAgents: AiAgentDefinition[] = [
  assistantAgent,
  triageAgent,
  postmortemWriterAgent,
  summarizerAgent,
  customerUpdateWriterAgent,
]

export default aiAgents
