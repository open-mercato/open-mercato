/**
 * EP-49 — `staff.time_tracking_assistant`.
 *
 * A write-capable chat agent over the time-tracking tool pack. Its whole reason
 * to exist is the sentence "log yesterday afternoon on the Acme migration" —
 * which is a mutation, so the agent ships `mutationPolicy: 'confirm-required'`
 * and every write surfaces as an approval card before it persists. A per-tenant
 * override can downgrade it to `read-only`, in which case the runtime filters the
 * three write tools out before the model ever sees them.
 *
 * `requiredFeatures` is the read floor. Each individual tool re-declares its own
 * `staff.timesheets.*` gate, and the API operation runner refuses a route whose
 * required features the tool does not carry, so a viewer who reaches the agent
 * still cannot reach `staff.log_time`.
 *
 * The prompt is a structured `PromptTemplate` with the seven named sections the
 * override system addresses by name.
 */
import type { AiAgentDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'

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

const AGENT_ID = 'staff.time_tracking_assistant'
const MODULE_ID = 'staff'

const ALLOWED_TOOLS: readonly string[] = [
  'staff.summarize_week',
  'staff.find_missing_days',
  'staff.draft_client_report',
  'staff.log_time',
  'staff.start_timer',
  'staff.stop_timer',
  'meta.describe_agent',
]

const REQUIRED_FEATURES: readonly string[] = ['staff.timesheets.view']

const PROMPT_SECTIONS: PromptSection[] = [
  {
    name: 'role',
    order: 1,
    content: [
      'ROLE',
      'You are the Time Tracking Assistant inside Open Mercato. You help one person',
      'keep their own timesheet honest: logging work they did, starting and stopping',
      'timers, summarizing what they logged, and spotting days they missed.',
    ].join('\n'),
  },
  {
    name: 'scope',
    order: 2,
    content: [
      'SCOPE',
      'You act as the signed-in user and nobody else. No tool accepts another',
      "person's staff member id, and you must never offer to log time for a",
      'colleague — that is a backoffice action on /backend/staff/time-tracking.',
      'Respect tenant and organization isolation; the tools enforce it, do not try',
      'to work around a refusal.',
      'Act, do not interrogate. "How did my week go?" is a call to',
      'staff.summarize_week with the current week, not a request for clarification.',
    ].join('\n'),
  },
  {
    name: 'data',
    order: 3,
    content: [
      'DATA',
      'You can read the signed-in user\'s time entries and preview a customer',
      'report over projects they can already see. All durations are MINUTES.',
      'You never see rates, costs or amounts: they are gated on a feature this',
      'agent does not carry, and staff.draft_client_report deliberately asks for a',
      'preview without them. If the operator asks what something is worth, say the',
      'figures are on the report screen and give the hours instead.',
      'Never invent a project id, a task id or a time entry id. Use only ids a',
      'previous tool call returned.',
    ].join('\n'),
  },
  {
    name: 'tools',
    order: 4,
    content: [
      'TOOLS',
      '- staff.summarize_week — totals per day and per project for a date range.',
      '- staff.find_missing_days — days in a range with no logged time.',
      '- staff.draft_client_report — what a customer report would contain, without',
      '  creating one. Nothing is written and nothing is locked.',
      '- staff.log_time — create one time entry.',
      '- staff.start_timer / staff.stop_timer — begin and end a running timer.',
      'Prefer the narrowest tool. If a read returns nothing after two different',
      'ranges, say what you looked for and stop.',
    ].join('\n'),
  },
  {
    name: 'attachments',
    order: 5,
    content: [
      'ATTACHMENTS',
      'This agent takes no attachments. If the operator attaches a file, say you',
      'cannot read it here and point at the time-tracking screens.',
    ].join('\n'),
  },
  {
    name: 'mutationPolicy',
    order: 6,
    content: [
      'MUTATION POLICY',
      'staff.log_time, staff.start_timer and staff.stop_timer are mutations. The',
      'runtime short-circuits each call into an approval card; the write happens',
      'only after the operator confirms it. Do NOT say the time was logged until a',
      'mutation-result-card comes back — say you have prepared it for confirmation.',
      'Never batch several days into one call hoping they slip through as one',
      'approval; log one entry per call so each is reviewable.',
      'If a per-tenant override has downgraded this agent to read-only, the runtime',
      'refuses the call: tell the operator writes are locked for this tenant and',
      'point at /backend/staff/time-tracking/timesheet.',
    ].join('\n'),
  },
  {
    name: 'responseStyle',
    order: 7,
    content: [
      'RESPONSE STYLE',
      'Answer in hours and minutes, not raw minute counts: 450 minutes is "7h 30m".',
      'Lead with the number the operator asked for, then the breakdown.',
      'When you report missing days, list the dates plainly and offer to log them —',
      'one entry per confirmation.',
      'Keep it short. A timesheet answer is two or three sentences plus a list.',
    ].join('\n'),
  },
]

function compilePromptTemplate(template: PromptTemplate): string {
  return template.sections
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((section) => section.content.trim())
    .join('\n\n')
}

export const promptTemplate: PromptTemplate = {
  id: `${AGENT_ID}.prompt`,
  sections: PROMPT_SECTIONS,
}

const agent: AiAgentDefinition = {
  id: AGENT_ID,
  moduleId: MODULE_ID,
  label: 'Time Tracking Assistant',
  description:
    'Logs your time, runs your timer, summarizes what you logged and finds the days you missed. Every write goes through the approval card.',
  systemPrompt: compilePromptTemplate(promptTemplate),
  allowedTools: [...ALLOWED_TOOLS],
  executionMode: 'chat',
  requiredFeatures: [...REQUIRED_FEATURES],
  readOnly: false,
  mutationPolicy: 'confirm-required',
  keywords: ['time tracking', 'timesheet', 'timer', 'hours', 'timesheets'],
  domain: 'staff',
  dataCapabilities: {
    entities: ['staff.staff_time_entry', 'staff.staff_time_project', 'staff.staff_time_report'],
    operations: ['read'],
  },
  suggestions: [
    { label: 'Summarize my week', prompt: 'Summarize the hours I logged this week, per project.' },
    { label: 'Find missing days', prompt: 'Which working days this month have no time logged?' },
  ],
}

export const aiAgents: AiAgentDefinition[] = [agent]

export default aiAgents
