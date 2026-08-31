import { createHash } from 'node:crypto';
import { Ajv, type ValidateFunction } from 'ajv';
import { dynamicTool, jsonSchema, type ToolSet } from 'ai';
import type { CapabilityBinding, RunEventSink } from '../contracts.js';
import type { ConnectorConfig, HarnessConfig } from '../config.js';
import { resolveHiddenArguments } from '../credentials/sources.js';
import type { CredentialResolver } from '../credentials/types.js';
import { HarnessError } from '../errors.js';
import { CliStdioCapabilityProvider } from './cli-stdio.js';
import { McpHttpCapabilityProvider } from './mcp-http.js';
import type {
  CapabilityLogSink,
  CapabilityProvider,
  CapabilitySession,
  CapabilityTool,
} from './types.js';

export interface BoundToolCatalogEntry {
  modelName: string;
  connectorId: string;
  toolName: string;
  description?: string;
  access: 'read' | 'write';
}

export interface BoundCapabilitySet {
  tools: ToolSet;
  catalog: BoundToolCatalogEntry[];
  digest: string;
  getToolCallCount(): number;
  close(): Promise<void>;
}

export interface BindCapabilitiesOptions {
  runId: string;
  runGrant: string;
  timeoutMs: number;
  maxToolCalls: number;
  bindings: CapabilityBinding[];
  signal?: AbortSignal;
  onEvent?: RunEventSink;
}

export class CapabilityGateway {
  private readonly providers: Record<ConnectorConfig['driver'], CapabilityProvider>;

  constructor(
    private readonly config: HarnessConfig,
    private readonly credentials: CredentialResolver,
    options: {
      providers?: Partial<Record<ConnectorConfig['driver'], CapabilityProvider>>;
      log?: CapabilityLogSink;
    } = {},
  ) {
    this.providers = {
      'mcp-http': options.providers?.['mcp-http'] ?? new McpHttpCapabilityProvider(),
      'cli-stdio': options.providers?.['cli-stdio'] ?? new CliStdioCapabilityProvider(options.log),
    };
  }

  async bind(options: BindCapabilitiesOptions): Promise<BoundCapabilitySet> {
    const sessions: CapabilitySession[] = [];
    let toolCalls = 0;
    try {
      const attempts = await Promise.allSettled(
        options.bindings.map(async (binding) => {
          const connector = this.config.connectors[binding.connectorId];
          if (!connector) {
            throw new HarnessError('POLICY_VIOLATION', `Unknown connector: ${binding.connectorId}`);
          }
          const credential = await this.credentials.resolve(
            {
              runId: options.runId,
              runGrant: options.runGrant,
              purpose: 'capability',
              audience: connector.credentialAudience,
              bindingId: connector.credentialBindingId,
              minimumTtlMs: options.timeoutMs + 5000,
            },
            options.signal,
          );
          const session = await this.providers[connector.driver].open({
            connectorId: binding.connectorId,
            config: connector,
            credential,
            runId: options.runId,
            ...(options.signal ? { signal: options.signal } : {}),
          });
          sessions.push(session);
          const available = await session.listTools(options.signal);
          return { binding, connector, credential, session, available };
        }),
      );
      const failed = attempts.find((attempt) => attempt.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      const bound = attempts
        .filter((attempt) => attempt.status === 'fulfilled')
        .map((attempt) => attempt.value);

      const tools: ToolSet = {};
      const catalog: BoundToolCatalogEntry[] = [];
      const ajv = new Ajv({ allErrors: true, strict: false });
      for (const item of bound) {
        const byName = new Map(item.available.map((tool) => [tool.name, tool]));
        for (const requestedName of item.binding.allowedTools) {
          const definition = byName.get(requestedName);
          if (!definition) {
            throw new HarnessError(
              'POLICY_VIOLATION',
              `Tool ${requestedName} is not exposed by connector ${item.binding.connectorId}`,
            );
          }
          if (item.binding.access === 'read' && definition.annotations?.readOnlyHint !== true) {
            throw new HarnessError(
              'POLICY_VIOLATION',
              `Tool ${requestedName} is not declared read-only but the binding grants read access`,
            );
          }
          const modelName = uniqueModelToolName(item.binding.connectorId, requestedName, tools);
          const hiddenArguments = resolveHiddenArguments(item.connector.hiddenArguments, item.credential);
          const visibleSchema = hideInputProperties(definition.inputSchema, Object.keys(hiddenArguments));
          const validate = compileSchema(ajv, visibleSchema, item.binding.connectorId, requestedName);
          tools[modelName] = dynamicTool({
            ...(definition.description ? { description: definition.description } : {}),
            inputSchema: jsonSchema(visibleSchema),
            execute: async (input) => {
              if (!isRecord(input) || !validate(input)) {
                throw new HarnessError('INVALID_REQUEST', `Invalid arguments for tool ${modelName}`, {
                  details: { errors: validate.errors ?? [] },
                });
              }
              toolCalls += 1;
              const callNumber = toolCalls;
              if (toolCalls > options.maxToolCalls) {
                throw new HarnessError('POLICY_VIOLATION', 'Agent exceeded the maximum tool call count');
              }
              const startedAt = Date.now();
              await emit(options.onEvent, {
                type: 'tool.started',
                runId: options.runId,
                toolName: modelName,
                connectorId: item.binding.connectorId,
                capabilityToolName: requestedName,
                call: callNumber,
                timestamp: new Date().toISOString(),
              });
              let isError = false;
              try {
                return await item.session.callTool(
                  requestedName,
                  { ...input, ...hiddenArguments },
                  options.signal,
                );
              } catch (error) {
                isError = true;
                throw error;
              } finally {
                await emit(options.onEvent, {
                  type: 'tool.finished',
                  runId: options.runId,
                  toolName: modelName,
                  connectorId: item.binding.connectorId,
                  capabilityToolName: requestedName,
                  call: callNumber,
                  durationMs: Date.now() - startedAt,
                  isError,
                  timestamp: new Date().toISOString(),
                });
              }
            },
          });
          catalog.push({
            modelName,
            connectorId: item.binding.connectorId,
            toolName: requestedName,
            ...(definition.description ? { description: definition.description } : {}),
            access: item.binding.access,
          });
        }
      }
      catalog.sort((left, right) => left.modelName.localeCompare(right.modelName));
      const digest = sha256(stableJson(catalog));
      return {
        tools,
        catalog,
        digest,
        getToolCallCount: () => toolCalls,
        close: () => closeSessions(sessions),
      };
    } catch (error) {
      await closeSessions(sessions);
      throw error;
    }
  }
}

function compileSchema(
  ajv: Ajv,
  schema: Record<string, unknown>,
  connectorId: string,
  toolName: string,
): ValidateFunction {
  try {
    return ajv.compile(schema);
  } catch (error) {
    throw new HarnessError(
      'CONNECTOR_FAILED',
      `Connector ${connectorId} exposed invalid JSON Schema for tool ${toolName}`,
      { cause: error },
    );
  }
}

function hideInputProperties(
  schema: Record<string, unknown>,
  hiddenNames: string[],
): Record<string, unknown> {
  const clone = structuredClone(schema);
  if (isRecord(clone.properties)) {
    for (const name of hiddenNames) delete clone.properties[name];
  }
  if (Array.isArray(clone.required)) {
    clone.required = clone.required.filter((name) => typeof name !== 'string' || !hiddenNames.includes(name));
  }
  return clone;
}

function uniqueModelToolName(connectorId: string, toolName: string, tools: ToolSet): string {
  const raw = `${sanitize(connectorId)}__${sanitize(toolName)}`;
  let candidate = raw.length <= 64 ? raw : `${raw.slice(0, 55)}_${sha256(raw).slice(0, 8)}`;
  if (tools[candidate]) candidate = `${candidate.slice(0, 55)}_${sha256(`${connectorId}:${toolName}`).slice(0, 8)}`;
  if (tools[candidate]) {
    throw new HarnessError('CONNECTOR_FAILED', `Tool name collision for ${connectorId}:${toolName}`);
  }
  return candidate;
}

function sanitize(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');
  return sanitized || 'tool';
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function closeSessions(sessions: CapabilitySession[]): Promise<void> {
  await Promise.allSettled(sessions.map((session) => session.close()));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function emit(
  sink: RunEventSink | undefined,
  event: Parameters<RunEventSink>[0],
): Promise<void> {
  try {
    await sink?.(event);
  } catch {
    // Observability is best-effort and must not change the business result.
  }
}

