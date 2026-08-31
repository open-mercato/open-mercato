import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { HarnessError } from './errors.js';

const CredentialSourceSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('credential-value') }).strict(),
  z
    .object({
      source: z.literal('credential-metadata'),
      key: z.string().min(1).max(128),
    })
    .strict(),
]);

const ConnectorBaseSchema = z.object({
  credentialAudience: z.string().min(1).max(256),
  credentialBindingId: z.string().min(1).max(128),
  hiddenArguments: z.record(z.string(), CredentialSourceSchema).optional(),
});

const McpHttpConnectorSchema = ConnectorBaseSchema.extend({
  driver: z.literal('mcp-http'),
  url: z.url(),
  headers: z.record(z.string(), z.string()).optional(),
  auth: z
    .object({
      headerName: z.string().min(1).max(128),
      scheme: z.string().max(64).optional(),
    })
    .strict()
    .optional(),
  requestTimeoutMs: z.number().int().positive().max(300_000).default(60_000),
}).strict();

const CliStdioConnectorSchema = ConnectorBaseSchema.extend({
  driver: z.literal('cli-stdio'),
  command: z.string().min(1).max(1024),
  args: z.array(z.string().max(2048)).max(64).default([]),
  credentialEnv: z.record(z.string(), CredentialSourceSchema).optional(),
  startupTimeoutMs: z.number().int().positive().max(60_000).default(10_000),
  requestTimeoutMs: z.number().int().positive().max(300_000).default(60_000),
  maxLineBytes: z.number().int().positive().max(16_777_216).default(1_048_576),
}).strict();

export const ConnectorConfigSchema = z.discriminatedUnion('driver', [
  McpHttpConnectorSchema,
  CliStdioConnectorSchema,
]);

const RuntimeProfileOverrideSchema = z
  .object({
    extends: z.enum(['business-v1', 'technical-v1']).optional(),
    maxSteps: z.number().int().positive().max(100).optional(),
    maxTimeoutMs: z.number().int().positive().max(1_800_000).optional(),
    maxToolCalls: z.number().int().nonnegative().max(1000).optional(),
    maxTools: z.number().int().positive().max(512).optional(),
    maxInstructionsChars: z.number().int().positive().max(1_000_000).optional(),
    maxPromptChars: z.number().int().positive().max(1_000_000).optional(),
    maxContextBytes: z.number().int().nonnegative().max(50_000_000).optional(),
    maxOutputTokens: z.number().int().positive().max(1_000_000).optional(),
    allowedConnectorDrivers: z.array(z.enum(['mcp-http', 'cli-stdio'])).min(1).optional(),
    allowedModelDrivers: z
      .array(z.enum(['openai', 'anthropic', 'openai-compatible']))
      .min(1)
      .optional(),
  })
  .strict();

export const HarnessConfigSchema = z
  .object({
    runtimeProfiles: z.record(z.string(), RuntimeProfileOverrideSchema).default({}),
    connectors: z.record(z.string(), ConnectorConfigSchema),
    modelPolicy: z
      .object({
        allowedOpenAICompatibleOrigins: z.array(z.url()).default([]),
      })
      .strict()
      .default({ allowedOpenAICompatibleOrigins: [] }),
  })
  .strict();

export type ConnectorConfig = z.infer<typeof ConnectorConfigSchema>;
export type McpHttpConnectorConfig = z.infer<typeof McpHttpConnectorSchema>;
export type CliStdioConnectorConfig = z.infer<typeof CliStdioConnectorSchema>;
export type CredentialSource = z.infer<typeof CredentialSourceSchema>;
export type HarnessConfig = z.infer<typeof HarnessConfigSchema>;
export type RuntimeProfileOverride = z.infer<typeof RuntimeProfileOverrideSchema>;

export interface RuntimeProcessConfig {
  credentialMode: 'broker' | 'env';
  credentialBrokerUrl?: string;
  environmentCredentialMap: Record<string, string>;
  harness: HarnessConfig;
}

export interface ProcessConfig extends RuntimeProcessConfig {
  host: string;
  port: number;
  serviceToken: string;
}

export async function loadRuntimeProcessConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<RuntimeProcessConfig> {
  const configPath = resolve(env.HARNESS_CONFIG_FILE ?? './harness.config.json');
  let file: string;
  try {
    file = await readFile(configPath, 'utf8');
  } catch (error) {
    throw new HarnessError('CONFIGURATION_ERROR', `Cannot read harness config at ${configPath}`, {
      cause: error,
    });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(file);
  } catch (error) {
    throw new HarnessError('CONFIGURATION_ERROR', `Harness config is not valid JSON: ${configPath}`, {
      cause: error,
    });
  }

  const parsed = HarnessConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new HarnessError('CONFIGURATION_ERROR', 'Harness config failed validation', {
      details: { issues: parsed.error.issues },
    });
  }

  const credentialMode = env.HARNESS_CREDENTIAL_MODE === 'env' ? 'env' : 'broker';
  const credentialBrokerUrl = env.HARNESS_CREDENTIAL_BROKER_URL;
  if (credentialMode === 'broker' && !credentialBrokerUrl) {
    throw new HarnessError('CONFIGURATION_ERROR', 'HARNESS_CREDENTIAL_BROKER_URL is required in broker mode');
  }

  let environmentCredentialMap: Record<string, string> = {};
  if (env.HARNESS_ENV_CREDENTIAL_MAP) {
    try {
      environmentCredentialMap = z
        .record(z.string(), z.string().min(1))
        .parse(JSON.parse(env.HARNESS_ENV_CREDENTIAL_MAP));
    } catch (error) {
      throw new HarnessError('CONFIGURATION_ERROR', 'HARNESS_ENV_CREDENTIAL_MAP must be a JSON object', {
        cause: error,
      });
    }
  }

  return {
    credentialMode,
    ...(credentialBrokerUrl ? { credentialBrokerUrl } : {}),
    environmentCredentialMap,
    harness: parsed.data,
  };
}

/**
 * Service tokens that ship in this repository's compose files, docs and examples.
 * A deployment reaching production with one of these is not "weakly configured".
 * It is publicly forgeable by anyone who has read the repository, so `POST /v1/runs`
 * would accept arbitrary execution bundles. `HARNESS_ALLOW_INSECURE_TOKEN=true` is
 * the explicit opt-out the local dev compose sets.
 */
const PLACEHOLDER_SERVICE_TOKENS = new Set(['open-mercato-business-harness-local-token']);

export async function loadProcessConfig(env: NodeJS.ProcessEnv = process.env): Promise<ProcessConfig> {
  const serviceToken = requiredEnv(env, 'HARNESS_SERVICE_TOKEN');
  if (serviceToken.length < 24) {
    throw new HarnessError('CONFIGURATION_ERROR', 'HARNESS_SERVICE_TOKEN must contain at least 24 characters');
  }
  if (
    PLACEHOLDER_SERVICE_TOKENS.has(serviceToken) &&
    env.HARNESS_ALLOW_INSECURE_TOKEN?.trim().toLowerCase() !== 'true'
  ) {
    throw new HarnessError(
      'CONFIGURATION_ERROR',
      'HARNESS_SERVICE_TOKEN is set to a placeholder published in this repository. Generate a real one with `openssl rand -hex 32`, or set HARNESS_ALLOW_INSECURE_TOKEN=true for local development.',
    );
  }
  const runtime = await loadRuntimeProcessConfig(env);
  return {
    ...runtime,
    host: env.HARNESS_HOST ?? '127.0.0.1',
    port: parsePort(env.HARNESS_PORT ?? '4300'),
    serviceToken,
  };
}

function parsePort(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new HarnessError('CONFIGURATION_ERROR', 'HARNESS_PORT must be a valid TCP port');
  }
  return value;
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new HarnessError('CONFIGURATION_ERROR', `${name} is required`);
  return value;
}
