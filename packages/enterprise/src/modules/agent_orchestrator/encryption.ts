import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    // Agent run input/output carry the operator prompt and the model's full
    // response — both PII-bearing. Encrypted at rest; the query engine
    // auto-decrypts on indexed reads, raw em.find reads use findWithDecryption.
    entityId: 'agent_orchestrator:agent_run',
    fields: [
      { field: 'input' },
      { field: 'output' },
    ],
  },
  {
    // Proposal payload is the agent's drafted action (e.g. an email body, a
    // deal-stage change) — sensitive customer data.
    entityId: 'agent_orchestrator:agent_proposal',
    fields: [
      { field: 'payload' },
    ],
  },
  {
    // Eval-case input/expected are promoted from corrections and golden runs,
    // so they inherit the same PII as the run/proposal they were drafted from.
    entityId: 'agent_orchestrator:agent_eval_case',
    fields: [
      { field: 'input' },
      { field: 'expected' },
    ],
  },
  {
    // Tool-call request/response summaries are redacted but still echo
    // tool arguments and results that can contain customer data.
    entityId: 'agent_orchestrator:agent_tool_call',
    fields: [
      { field: 'request_summary' },
      { field: 'response_summary' },
    ],
  },
]

export default defaultEncryptionMaps
