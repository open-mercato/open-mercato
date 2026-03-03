import { z } from 'zod'

export const autonomyModeSchema = z.enum(['propose', 'assist', 'auto'])
export const actionClassSchema = z.enum(['read', 'write', 'irreversible'])
export const riskLevelSchema = z.enum(['low', 'medium', 'high', 'critical'])
export const runStatusSchema = z.enum(['queued', 'running', 'checkpoint', 'paused', 'failed', 'completed', 'terminated'])
export const runStepStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'skipped'])
export const approvalStatusSchema = z.enum(['pending', 'approved', 'rejected', 'expired'])
export const decisionControlPathSchema = z.enum(['auto', 'checkpoint', 'override', 'rejected'])
export const decisionStatusSchema = z.enum(['success', 'failed', 'blocked'])
export const skillStatusSchema = z.enum(['draft', 'validated', 'active', 'deprecated'])
export const skillSourceTypeSchema = z.enum(['interview', 'trace_mining', 'hybrid'])

const idempotencyKeySchema = z.string().min(8).max(128)

const scopedCreateFields = {
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
}

export const agentPolicyCreateSchema = z.object({
  ...scopedCreateFields,
  name: z.string().min(1).max(200),
  description: z.string().max(4000).optional().nullable(),
  defaultMode: autonomyModeSchema.default('propose'),
  isActive: z.boolean().optional(),
})

export const agentPolicyUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).optional().nullable(),
  defaultMode: autonomyModeSchema.optional(),
  isActive: z.boolean().optional(),
})

export const agentRiskBandCreateSchema = z.object({
  ...scopedCreateFields,
  name: z.string().min(1).max(200),
  riskLevel: riskLevelSchema,
  description: z.string().max(4000).optional().nullable(),
  requiresApproval: z.boolean().optional(),
  failClosed: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  minScore: z.number().int().min(0).max(100).optional(),
  maxScore: z.number().int().min(0).max(100).optional(),
})

export const agentRiskBandUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  riskLevel: riskLevelSchema.optional(),
  description: z.string().max(4000).optional().nullable(),
  requiresApproval: z.boolean().optional(),
  failClosed: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  minScore: z.number().int().min(0).max(100).optional(),
  maxScore: z.number().int().min(0).max(100).optional(),
})

export const agentPlaybookCreateSchema = z.object({
  ...scopedCreateFields,
  name: z.string().min(1).max(200),
  description: z.string().max(4000).optional().nullable(),
  policyId: z.string().uuid().optional().nullable(),
  riskBandId: z.string().uuid().optional().nullable(),
  triggerType: z.enum(['manual', 'scheduled']).default('manual'),
  scheduleCron: z.string().max(200).optional().nullable(),
  isActive: z.boolean().optional(),
})

export const agentPlaybookUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).optional().nullable(),
  policyId: z.string().uuid().optional().nullable(),
  riskBandId: z.string().uuid().optional().nullable(),
  triggerType: z.enum(['manual', 'scheduled']).optional(),
  scheduleCron: z.string().max(200).optional().nullable(),
  isActive: z.boolean().optional(),
})

export const runStartSchema = z.object({
  ...scopedCreateFields,
  playbookId: z.string().uuid().optional().nullable(),
  policyId: z.string().uuid().optional().nullable(),
  riskBandId: z.string().uuid().optional().nullable(),
  autonomyMode: autonomyModeSchema.default('propose'),
  actionClass: actionClassSchema.optional(),
  actionType: z.string().min(1).max(200),
  targetEntity: z.string().min(1).max(200),
  targetId: z.string().max(255).optional().nullable(),
  inputContext: z.record(z.string(), z.unknown()).optional().nullable(),
  sourceRefs: z.array(z.string().max(500)).optional(),
  riskScore: z.number().int().min(0).max(100).optional().nullable(),
  requireApproval: z.boolean().optional(),
  idempotencyKey: idempotencyKeySchema.optional(),
})

export const runControlSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().max(2000).optional().nullable(),
  expectedStatus: runStatusSchema.optional(),
})

export const runRerouteSchema = z.object({
  id: z.string().uuid(),
  playbookId: z.string().uuid().optional().nullable(),
  policyId: z.string().uuid().optional().nullable(),
  riskBandId: z.string().uuid().optional().nullable(),
  reason: z.string().max(2000).optional().nullable(),
  expectedStatus: runStatusSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.playbookId === undefined && value.policyId === undefined && value.riskBandId === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['id'],
      message: 'At least one reroute target must be provided.',
    })
  }
})

export const approvalDecisionSchema = z.object({
  id: z.string().uuid(),
  comment: z.string().max(2000).optional().nullable(),
  idempotencyKey: idempotencyKeySchema.optional(),
})

export const agentSkillCreateSchema = z.object({
  ...scopedCreateFields,
  name: z.string().min(1).max(200),
  description: z.string().max(4000).optional().nullable(),
  status: skillStatusSchema.optional(),
  frameworkJson: z.record(z.string(), z.unknown()).optional().nullable(),
  sourceType: skillSourceTypeSchema.optional(),
})

export const agentSkillUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).optional().nullable(),
  status: skillStatusSchema.optional(),
  frameworkJson: z.record(z.string(), z.unknown()).optional().nullable(),
  sourceType: skillSourceTypeSchema.optional(),
})

export const agentSkillPromoteSchema = z.object({
  id: z.string().uuid(),
  diffJson: z.record(z.string(), z.unknown()).optional().nullable(),
  validationReportJson: z.record(z.string(), z.unknown()).optional().nullable(),
  idempotencyKey: idempotencyKeySchema.optional(),
})

export const agentSkillCaptureFromTraceSchema = z.object({
  ...scopedCreateFields,
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).optional().nullable(),
  decisionEventIds: z.array(z.string().uuid()).max(250).optional(),
  actionType: z.string().min(1).max(200).optional(),
  targetEntity: z.string().min(1).max(200).optional(),
  targetId: z.string().max(255).optional().nullable(),
  postmortem: z.string().max(10000).optional().nullable(),
  sampleSize: z.number().int().min(1).max(250).optional(),
  autoValidate: z.boolean().optional().default(false),
  passRateThreshold: z.number().min(0).max(1).optional(),
  approvalDecision: z.enum(['approve', 'reject']).optional().default('approve'),
  idempotencyKey: idempotencyKeySchema.optional(),
})

export const agentSkillValidateSchema = z.object({
  id: z.string().uuid(),
  sampleSize: z.number().int().min(1).max(250).optional().default(60),
  passRateThreshold: z.number().min(0).max(1).optional().default(0.6),
  approvalDecision: z.enum(['approve', 'reject']).optional().default('approve'),
  comment: z.string().max(2000).optional().nullable(),
  idempotencyKey: idempotencyKeySchema.optional(),
})

export const decisionTelemetryEnvelopeSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  runId: z.string().uuid().optional().nullable(),
  stepId: z.string().max(200).optional().nullable(),
  actionType: z.string().min(1).max(200),
  targetEntity: z.string().min(1).max(200),
  targetId: z.string().max(255).optional().nullable(),
  sourceRefs: z.array(z.string().max(500)).default([]),
  policyId: z.string().uuid().optional().nullable(),
  riskBandId: z.string().uuid().optional().nullable(),
  riskScore: z.number().int().min(0).max(100).optional().nullable(),
  controlPath: decisionControlPathSchema,
  approverIds: z.array(z.string().uuid()).default([]),
  exceptionIds: z.array(z.string().max(255)).default([]),
  writeSet: z.record(z.string(), z.unknown()).optional().nullable(),
  status: decisionStatusSchema,
  errorCode: z.string().max(120).optional().nullable(),
  harnessProvider: z.string().max(120).optional().nullable(),
  supersedesEventId: z.string().uuid().optional().nullable(),
  signature: z.string().max(255).optional().nullable(),
})

export const decisionSupersedeSchema = z.object({
  id: z.string().uuid(),
  sourceRefs: z.array(z.string().max(500)).optional(),
  writeSet: z.record(z.string(), z.unknown()).optional().nullable(),
  status: decisionStatusSchema.optional(),
  errorCode: z.string().max(120).optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
})

export const precedentSearchSchema = z.object({
  query: z.string().min(1).max(255),
  limit: z.number().int().min(1).max(100).optional().default(20),
  signature: z.string().max(255).optional(),
})

export const precedentExplainSchema = z.object({
  eventId: z.string().uuid(),
})

export const contextGraphNeighborsSchema = z.object({
  eventId: z.string().uuid(),
  limit: z.number().int().min(1).max(100).optional().default(20),
})

export type AgentPolicyCreateInput = z.infer<typeof agentPolicyCreateSchema>
export type AgentPolicyUpdateInput = z.infer<typeof agentPolicyUpdateSchema>
export type AgentRiskBandCreateInput = z.infer<typeof agentRiskBandCreateSchema>
export type AgentRiskBandUpdateInput = z.infer<typeof agentRiskBandUpdateSchema>
export type AgentPlaybookCreateInput = z.infer<typeof agentPlaybookCreateSchema>
export type AgentPlaybookUpdateInput = z.infer<typeof agentPlaybookUpdateSchema>
export type RunStartInput = z.infer<typeof runStartSchema>
export type RunControlInput = z.infer<typeof runControlSchema>
export type RunRerouteInput = z.infer<typeof runRerouteSchema>
export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>
export type AgentSkillCreateInput = z.infer<typeof agentSkillCreateSchema>
export type AgentSkillUpdateInput = z.infer<typeof agentSkillUpdateSchema>
export type AgentSkillPromoteInput = z.infer<typeof agentSkillPromoteSchema>
export type AgentSkillCaptureFromTraceInput = z.infer<typeof agentSkillCaptureFromTraceSchema>
export type AgentSkillValidateInput = z.infer<typeof agentSkillValidateSchema>
export type DecisionTelemetryEnvelopeInput = z.infer<typeof decisionTelemetryEnvelopeSchema>
export type DecisionSupersedeInput = z.infer<typeof decisionSupersedeSchema>
