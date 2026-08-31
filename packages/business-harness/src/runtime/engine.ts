import { Ajv } from 'ajv';
import { Ajv2019 } from 'ajv/dist/2019.js';
import { Ajv2020 } from 'ajv/dist/2020.js';
import {
  jsonSchema,
  Output,
  stepCountIs,
  ToolLoopAgent,
  type LanguageModel,
  type ToolLoopAgentSettings,
  type ToolSet,
} from 'ai';
import type { ModelSettings, OutputContract, RunEventSink, RunUsage } from '../contracts.js';
import { HarnessError } from '../errors.js';

export interface AgentEngineRequest {
  runId: string;
  model: LanguageModel;
  instructions: string;
  prompt: string;
  tools: ToolSet;
  output: OutputContract;
  settings: ModelSettings;
  providerOptions?: ToolLoopAgentSettings['providerOptions'];
  maxSteps: number;
  signal: AbortSignal;
  onEvent?: RunEventSink;
}

export interface AgentEngineResult {
  output: unknown;
  usage: RunUsage;
  steps: number;
}

export interface AgentEngine {
  run(request: AgentEngineRequest): Promise<AgentEngineResult>;
}

export class VercelAiAgentEngine implements AgentEngine {
  async run(request: AgentEngineRequest): Promise<AgentEngineResult> {
    const output = createOutputContract(request.output);
    const agent = new ToolLoopAgent({
      id: request.runId,
      model: request.model,
      instructions: request.instructions,
      tools: request.tools,
      output,
      stopWhen: stepCountIs(request.maxSteps),
      ...(request.settings.temperature !== undefined
        ? { temperature: request.settings.temperature }
        : {}),
      ...(request.settings.topP !== undefined ? { topP: request.settings.topP } : {}),
      ...(request.settings.maxOutputTokens !== undefined
        ? { maxOutputTokens: request.settings.maxOutputTokens }
        : {}),
      ...(request.settings.maxRetries !== undefined ? { maxRetries: request.settings.maxRetries } : {}),
      ...(request.settings.seed !== undefined ? { seed: request.settings.seed } : {}),
      ...(request.providerOptions ? { providerOptions: request.providerOptions } : {}),
      onStepEnd: async (event) => {
        try {
          await request.onEvent?.({
            type: 'step.finished',
            runId: request.runId,
            step: event.stepNumber,
            finishReason: event.finishReason,
            usage: compactUsage(event.usage),
            timestamp: new Date().toISOString(),
          });
        } catch {
          // Observability is best-effort and must not change model execution.
        }
      },
    });

    try {
      const result = await agent.generate({
        prompt: request.prompt,
        abortSignal: request.signal,
      });
      return {
        output: result.output,
        usage: compactUsage(result.usage),
        steps: result.steps.length,
      };
    } catch (error) {
      if (request.signal.aborted) throw request.signal.reason ?? error;
      throw new HarnessError('MODEL_FAILED', 'Model execution failed', { cause: error });
    }
  }
}

function createOutputContract(contract: OutputContract) {
  if (contract.mode === 'text') return Output.text();
  let validate;
  try {
    validate = createJsonSchemaValidator(contract.schema);
  } catch (error) {
    throw new HarnessError('INVALID_REQUEST', 'Agent output schema is invalid', { cause: error });
  }
  return Output.object({
    schema: jsonSchema(contract.schema, {
      validate: (value) =>
        validate(value)
          ? { success: true, value }
          : {
              success: false,
              error: new Error(`Output failed JSON Schema validation: ${JSON.stringify(validate.errors)}`),
            },
    }),
    ...(contract.name ? { name: contract.name } : {}),
    ...(contract.description ? { description: contract.description } : {}),
  });
}

function createJsonSchemaValidator(schema: Record<string, unknown>) {
  const options = { allErrors: true, strict: false } as const;
  const dialect = schema.$schema;

  if (typeof dialect === 'string' && dialect.includes('draft/2020-12')) {
    return new Ajv2020(options).compile(schema);
  }
  if (typeof dialect === 'string' && dialect.includes('draft/2019-09')) {
    return new Ajv2019(options).compile(schema);
  }
  return new Ajv(options).compile(schema);
}

function compactUsage(usage: {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
}): RunUsage {
  return {
    ...(usage.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
    ...(usage.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
    ...(usage.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
  };
}
