import type { AgentExecutionBundle, ModelBinding } from './contracts.js';
import type { ConnectorConfig, HarnessConfig, RuntimeProfileOverride } from './config.js';
import { HarnessError } from './errors.js';

export interface RuntimeProfile {
  id: string;
  maxSteps: number;
  maxTimeoutMs: number;
  maxToolCalls: number;
  maxTools: number;
  maxInstructionsChars: number;
  maxPromptChars: number;
  maxContextBytes: number;
  maxOutputTokens: number;
  allowedConnectorDrivers: ConnectorConfig['driver'][];
  allowedModelDrivers: ModelBinding['driver'][];
}

const BUILTIN_PROFILES: Record<'business-v1' | 'technical-v1', RuntimeProfile> = {
  'business-v1': {
    id: 'business-v1',
    maxSteps: 12,
    maxTimeoutMs: 120_000,
    maxToolCalls: 40,
    maxTools: 48,
    maxInstructionsChars: 40_000,
    maxPromptChars: 100_000,
    maxContextBytes: 1_000_000,
    maxOutputTokens: 16_384,
    allowedConnectorDrivers: ['mcp-http', 'cli-stdio'],
    allowedModelDrivers: ['openai', 'anthropic', 'openai-compatible'],
  },
  'technical-v1': {
    id: 'technical-v1',
    maxSteps: 24,
    maxTimeoutMs: 300_000,
    maxToolCalls: 100,
    maxTools: 128,
    maxInstructionsChars: 100_000,
    maxPromptChars: 200_000,
    maxContextBytes: 5_000_000,
    maxOutputTokens: 32_768,
    allowedConnectorDrivers: ['mcp-http', 'cli-stdio'],
    allowedModelDrivers: ['openai', 'anthropic', 'openai-compatible'],
  },
};

export function resolveRuntimeProfile(profileId: string, config: HarnessConfig): RuntimeProfile {
  const override = config.runtimeProfiles[profileId];
  const builtin = BUILTIN_PROFILES[profileId as keyof typeof BUILTIN_PROFILES];
  const baseId = override?.extends ?? builtin?.id;
  if (!baseId) {
    throw new HarnessError('POLICY_VIOLATION', `Unknown runtime profile: ${profileId}`);
  }
  const base = BUILTIN_PROFILES[baseId as keyof typeof BUILTIN_PROFILES];
  if (!base) {
    throw new HarnessError('CONFIGURATION_ERROR', `Invalid base runtime profile: ${baseId}`);
  }
  return mergeProfile(profileId, base, override);
}

function mergeProfile(
  id: string,
  base: RuntimeProfile,
  override: RuntimeProfileOverride | undefined,
): RuntimeProfile {
  if (!override) return { ...base, id };
  return {
    id,
    maxSteps: override.maxSteps ?? base.maxSteps,
    maxTimeoutMs: override.maxTimeoutMs ?? base.maxTimeoutMs,
    maxToolCalls: override.maxToolCalls ?? base.maxToolCalls,
    maxTools: override.maxTools ?? base.maxTools,
    maxInstructionsChars: override.maxInstructionsChars ?? base.maxInstructionsChars,
    maxPromptChars: override.maxPromptChars ?? base.maxPromptChars,
    maxContextBytes: override.maxContextBytes ?? base.maxContextBytes,
    maxOutputTokens: override.maxOutputTokens ?? base.maxOutputTokens,
    allowedConnectorDrivers: override.allowedConnectorDrivers ?? base.allowedConnectorDrivers,
    allowedModelDrivers: override.allowedModelDrivers ?? base.allowedModelDrivers,
  };
}

export function enforceRunPolicy(bundle: AgentExecutionBundle, config: HarnessConfig): RuntimeProfile {
  const profile = resolveRuntimeProfile(bundle.agent.runtimeProfile, config);
  const { agent, input } = bundle;

  assertAtMost(agent.loop.maxSteps, profile.maxSteps, 'maxSteps');
  assertAtMost(agent.loop.timeoutMs, profile.maxTimeoutMs, 'timeoutMs');
  assertAtMost(agent.loop.maxToolCalls, profile.maxToolCalls, 'maxToolCalls');
  assertAtMost(agent.instructions.length, profile.maxInstructionsChars, 'instructions length');
  assertAtMost(input.prompt.length, profile.maxPromptChars, 'prompt length');
  assertAtMost(Buffer.byteLength(JSON.stringify(input.context ?? {})), profile.maxContextBytes, 'context size');
  assertAtMost(agent.model.settings?.maxOutputTokens ?? 0, profile.maxOutputTokens, 'maxOutputTokens');

  if (!profile.allowedModelDrivers.includes(agent.model.driver)) {
    throw new HarnessError(
      'POLICY_VIOLATION',
      `Model driver ${agent.model.driver} is not allowed by profile ${profile.id}`,
    );
  }

  if (agent.model.driver === 'openai-compatible') {
    enforceCompatibleOrigin(agent.model.baseUrl, config.modelPolicy.allowedOpenAICompatibleOrigins);
  }

  let selectedTools = 0;
  const connectorIds = new Set<string>();
  for (const capability of agent.capabilities) {
    if (connectorIds.has(capability.connectorId)) {
      throw new HarnessError(
        'POLICY_VIOLATION',
        `Connector ${capability.connectorId} is bound more than once`,
      );
    }
    connectorIds.add(capability.connectorId);
    const connector = config.connectors[capability.connectorId];
    if (!connector) {
      throw new HarnessError('POLICY_VIOLATION', `Unknown connector: ${capability.connectorId}`);
    }
    if (!profile.allowedConnectorDrivers.includes(connector.driver)) {
      throw new HarnessError(
        'POLICY_VIOLATION',
        `Connector driver ${connector.driver} is not allowed by profile ${profile.id}`,
      );
    }
    const uniqueTools = new Set(capability.allowedTools);
    if (uniqueTools.size !== capability.allowedTools.length) {
      throw new HarnessError(
        'POLICY_VIOLATION',
        `Connector ${capability.connectorId} contains duplicate tool names`,
      );
    }
    if (capability.allowedTools.includes('*')) {
      throw new HarnessError('POLICY_VIOLATION', 'Wildcard tool access is not allowed');
    }
    selectedTools += capability.allowedTools.length;
  }
  assertAtMost(selectedTools, profile.maxTools, 'selected tool count');
  return profile;
}

function enforceCompatibleOrigin(baseUrl: string | undefined, allowedOrigins: string[]): void {
  if (!baseUrl) {
    throw new HarnessError('POLICY_VIOLATION', 'OpenAI-compatible model is missing baseUrl');
  }
  const requested = new URL(baseUrl).origin;
  const allowed = allowedOrigins.some((entry) => new URL(entry).origin === requested);
  if (!allowed) {
    throw new HarnessError('POLICY_VIOLATION', `Model endpoint origin is not allowlisted: ${requested}`);
  }
}

function assertAtMost(actual: number, maximum: number, field: string): void {
  if (actual > maximum) {
    throw new HarnessError('POLICY_VIOLATION', `${field} exceeds profile limit`, {
      details: { field, actual, maximum },
    });
  }
}

