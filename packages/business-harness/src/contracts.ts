import { z } from 'zod';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type JsonSchema = Record<string, unknown>;

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

const JsonObjectSchema = z.record(z.string(), JsonValueSchema);
const JsonSchemaSchema = z.record(z.string(), z.unknown());

export const ModelSettingsSchema = z
  .object({
    temperature: z.number().min(0).max(2).optional(),
    topP: z.number().min(0).max(1).optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    maxRetries: z.number().int().min(0).max(5).optional(),
    seed: z.number().int().optional(),
  })
  .strict();

export const ModelBindingSchema = z
  .object({
    bindingId: z.string().min(1).max(128),
    bindingRevision: z.string().min(1).max(128),
    driver: z.enum(['openai', 'anthropic', 'openai-compatible']),
    modelId: z.string().min(1).max(256),
    baseUrl: z.url().optional(),
    credentialBindingId: z.string().min(1).max(128),
    settings: ModelSettingsSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.driver === 'openai-compatible' && !value.baseUrl) {
      ctx.addIssue({
        code: 'custom',
        path: ['baseUrl'],
        message: 'baseUrl is required for an OpenAI-compatible provider',
      });
    }
    if (value.driver !== 'openai-compatible' && value.baseUrl) {
      ctx.addIssue({
        code: 'custom',
        path: ['baseUrl'],
        message: 'baseUrl is only allowed for an OpenAI-compatible provider',
      });
    }
  });

export const CapabilityBindingSchema = z
  .object({
    connectorId: z.string().min(1).max(128),
    allowedTools: z.array(z.string().min(1).max(256)).min(1).max(128),
    access: z.enum(['read', 'write']).default('read'),
  })
  .strict();

export const LoopSettingsSchema = z
  .object({
    maxSteps: z.number().int().positive(),
    timeoutMs: z.number().int().positive(),
    maxToolCalls: z.number().int().nonnegative(),
  })
  .strict();

export const OutputContractSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('text'),
    })
    .strict(),
  z
    .object({
      mode: z.literal('object'),
      schema: JsonSchemaSchema,
      name: z.string().min(1).max(64).optional(),
      description: z.string().max(512).optional(),
    })
    .strict(),
]);

export const AgentExecutionBundleSchema = z
  .object({
    protocolVersion: z.literal('1'),
    runId: z.string().min(1).max(128),
    agent: z
      .object({
        id: z.string().min(1).max(128),
        version: z.string().min(1).max(128),
        digest: z.string().min(8).max(256),
        runtimeProfile: z.string().min(1).max(128),
        instructions: z.string().min(1),
        model: ModelBindingSchema,
        capabilities: z.array(CapabilityBindingSchema).max(16),
        loop: LoopSettingsSchema,
        output: OutputContractSchema,
      })
      .strict(),
    input: z
      .object({
        prompt: z.string().min(1),
        context: JsonObjectSchema.optional(),
      })
      .strict(),
    authorization: z
      .object({
        runGrant: z.string().min(16).max(8192),
      })
      .strict(),
  })
  .strict();

export type ModelSettings = z.infer<typeof ModelSettingsSchema>;
export type ModelBinding = z.infer<typeof ModelBindingSchema>;
export type CapabilityBinding = z.infer<typeof CapabilityBindingSchema>;
export type OutputContract = z.infer<typeof OutputContractSchema>;
export type AgentExecutionBundle = z.infer<typeof AgentExecutionBundleSchema>;

export interface RunUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface RunIdentity {
  runId: string;
  agentId: string;
  agentVersion: string;
  agentDigest: string;
  runtimeProfile: string;
  model: {
    bindingId: string;
    bindingRevision: string;
    driver: ModelBinding['driver'];
    modelId: string;
  };
  connectors: string[];
  toolCatalogDigest: string;
}

export interface AgentRunResult {
  protocolVersion: '1';
  status: 'completed';
  identity: RunIdentity;
  output: unknown;
  usage: RunUsage;
  steps: number;
  toolCalls: number;
  durationMs: number;
}

export type RunEvent =
  | { type: 'run.started'; runId: string; timestamp: string }
  | { type: 'capabilities.ready'; runId: string; toolCount: number; timestamp: string }
  | {
      type: 'step.finished';
      runId: string;
      step: number;
      finishReason: string;
      usage: RunUsage;
      timestamp: string;
    }
  | {
      type: 'tool.started';
      runId: string;
      toolName: string;
      connectorId: string;
      capabilityToolName: string;
      call: number;
      timestamp: string;
    }
  | {
      type: 'tool.finished';
      runId: string;
      toolName: string;
      connectorId: string;
      capabilityToolName: string;
      call: number;
      durationMs: number;
      isError: boolean;
      timestamp: string;
    }
  | { type: 'run.completed'; runId: string; durationMs: number; timestamp: string }
  | { type: 'run.failed'; runId: string; code: string; timestamp: string };

export type RunEventSink = (event: RunEvent) => void | Promise<void>;

