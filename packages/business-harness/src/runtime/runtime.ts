import { AgentExecutionBundleSchema, type AgentExecutionBundle, type AgentRunResult, type RunEventSink } from '../contracts.js';
import type { HarnessConfig } from '../config.js';
import { CapabilityGateway } from '../capabilities/gateway.js';
import { HarnessError, toHarnessError } from '../errors.js';
import type { ModelResolver } from '../models/resolver.js';
import { enforceRunPolicy } from '../profiles.js';
import type { AgentEngine } from './engine.js';

export interface BusinessAgentRuntimeOptions {
  config: HarnessConfig;
  modelResolver: ModelResolver;
  capabilities: CapabilityGateway;
  engine: AgentEngine;
}

export interface RunOptions {
  signal?: AbortSignal;
  onEvent?: RunEventSink;
}

export class BusinessAgentRuntime {
  constructor(private readonly options: BusinessAgentRuntimeOptions) {}

  async run(input: unknown, options: RunOptions = {}): Promise<AgentRunResult> {
    const parsed = AgentExecutionBundleSchema.safeParse(input);
    if (!parsed.success) {
      throw new HarnessError('INVALID_REQUEST', 'Agent execution bundle failed validation', {
        details: { issues: parsed.error.issues },
      });
    }
    const bundle = parsed.data;
    enforceRunPolicy(bundle, this.options.config);
    const startedAt = Date.now();
    const deadline = AbortSignal.timeout(bundle.agent.loop.timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
    let boundCapabilities: Awaited<ReturnType<CapabilityGateway['bind']>> | undefined;

    await emit(options.onEvent, {
      type: 'run.started',
      runId: bundle.runId,
      timestamp: new Date().toISOString(),
    });

    try {
      const model = await this.options.modelResolver.resolve(bundle.agent.model, {
        runId: bundle.runId,
        runGrant: bundle.authorization.runGrant,
        timeoutMs: bundle.agent.loop.timeoutMs,
        signal,
      });
      boundCapabilities = await this.options.capabilities.bind({
        runId: bundle.runId,
        runGrant: bundle.authorization.runGrant,
        timeoutMs: bundle.agent.loop.timeoutMs,
        maxToolCalls: bundle.agent.loop.maxToolCalls,
        bindings: bundle.agent.capabilities,
        signal,
        ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      });
      await emit(options.onEvent, {
        type: 'capabilities.ready',
        runId: bundle.runId,
        toolCount: boundCapabilities.catalog.length,
        timestamp: new Date().toISOString(),
      });

      const engineResult = await this.options.engine.run({
        runId: bundle.runId,
        model: model.model,
        instructions: bundle.agent.instructions,
        prompt: buildPrompt(bundle),
        tools: boundCapabilities.tools,
        output: bundle.agent.output,
        settings: bundle.agent.model.settings ?? {},
        ...(model.providerOptions ? { providerOptions: model.providerOptions } : {}),
        maxSteps: bundle.agent.loop.maxSteps,
        signal,
        ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      });
      const durationMs = Date.now() - startedAt;
      const result: AgentRunResult = {
        protocolVersion: '1',
        status: 'completed',
        identity: {
          runId: bundle.runId,
          agentId: bundle.agent.id,
          agentVersion: bundle.agent.version,
          agentDigest: bundle.agent.digest,
          runtimeProfile: bundle.agent.runtimeProfile,
          model: {
            bindingId: bundle.agent.model.bindingId,
            bindingRevision: bundle.agent.model.bindingRevision,
            driver: model.driver,
            modelId: model.modelId,
          },
          connectors: bundle.agent.capabilities.map((item) => item.connectorId),
          toolCatalogDigest: boundCapabilities.digest,
        },
        output: engineResult.output,
        usage: engineResult.usage,
        steps: engineResult.steps,
        toolCalls: boundCapabilities.getToolCallCount(),
        durationMs,
      };
      await emit(options.onEvent, {
        type: 'run.completed',
        runId: bundle.runId,
        durationMs,
        timestamp: new Date().toISOString(),
      });
      return result;
    } catch (error) {
      const normalized = normalizeRunError(error, deadline, options.signal);
      await emit(options.onEvent, {
        type: 'run.failed',
        runId: bundle.runId,
        code: normalized.code,
        timestamp: new Date().toISOString(),
      });
      throw normalized;
    } finally {
      await boundCapabilities?.close().catch(() => undefined);
    }
  }
}

function buildPrompt(bundle: AgentExecutionBundle): string {
  if (!bundle.input.context) return bundle.input.prompt;
  return [
    bundle.input.prompt,
    '',
    '<open_mercato_context>',
    JSON.stringify(bundle.input.context),
    '</open_mercato_context>',
  ].join('\n');
}

function normalizeRunError(
  error: unknown,
  deadline: AbortSignal,
  externalSignal: AbortSignal | undefined,
): HarnessError {
  if (deadline.aborted) {
    return new HarnessError('RUN_TIMEOUT', 'Agent execution exceeded its deadline', { cause: error });
  }
  if (externalSignal?.aborted) {
    return new HarnessError('RUN_ABORTED', 'Agent execution was aborted by the caller', { cause: error });
  }
  return toHarnessError(error);
}

async function emit<T>(sink: RunEventSink | undefined, event: T): Promise<void> {
  try {
    if (sink) await sink(event as Parameters<RunEventSink>[0]);
  } catch {
    // Observability is best-effort and must not change the business result.
  }
}
