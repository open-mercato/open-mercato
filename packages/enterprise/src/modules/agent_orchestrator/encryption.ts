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
    // A replay failure message can quote model output verbatim.
    entityId: 'agent_orchestrator:agent_eval_case_run',
    fields: [{ field: 'error_message' }],
  },
  {
    // Where the excerpts ACTUALLY live: scorer evidence carries extracted output
    // values, tool-call arguments, field-level diffs, and the judge's free-text
    // reasoning ABOUT the decrypted output. This is the column that needed the
    // protection the suite-summary entry below was mistakenly credited with.
    entityId: 'agent_orchestrator:agent_eval_result',
    fields: [{ field: 'evidence' }],
  },
  {
    // Aggregate counters today, but it is the natural home for per-assertion
    // excerpts and sits alongside encrypted siblings — kept encrypted so adding
    // one later cannot silently expose it.
    entityId: 'agent_orchestrator:agent_eval_suite_run',
    fields: [{ field: 'summary' }],
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
  {
    // Agentic-task default input mirrors agent_run.input's treatment — it is
    // literally the template for that input, so it inherits the same PII risk.
    entityId: 'agent_orchestrator:agent_task_definition',
    fields: [
      { field: 'input_defaults' },
    ],
  },
  {
    // The resolved input actually used by a task run, plus the failure reason
    // (which may echo part of a malformed input back on validation failure).
    entityId: 'agent_orchestrator:agent_task_run',
    fields: [
      { field: 'input' },
      { field: 'failure_reason' },
    ],
  },
  {
    // The process projection's free-text, person-readable subject title (e.g.
    // "Motor collision — payout adjudication"). The ONLY encrypted subject
    // field: the filter-driving facets (subject_type/value/fraud) are deliberate
    // plaintext typed columns because they must be SQL-queryable.
    entityId: 'agent_orchestrator:agent_process',
    fields: [
      { field: 'subject_title' },
    ],
  },
  {
    // Agent-produced artifact caption is free text the model authored about the
    // file — it can quote customer data pulled into the run. The file bytes are
    // encrypted separately in storage-s3; this covers the DB-resident metadata.
    entityId: 'agent_orchestrator:agent_run_artifact',
    fields: [
      { field: 'caption' },
    ],
  },
]

export default defaultEncryptionMaps
