import type { ConnectorConfig } from '../config.js';
import type { CredentialLease } from '../credentials/types.js';

export interface CapabilityToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface CapabilityTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: CapabilityToolAnnotations;
}

export interface CapabilitySession {
  listTools(signal?: AbortSignal): Promise<CapabilityTool[]>;
  callTool(name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
}

export interface OpenCapabilitySessionOptions {
  connectorId: string;
  config: ConnectorConfig;
  credential: CredentialLease;
  runId: string;
  signal?: AbortSignal;
}

export interface CapabilityProvider {
  open(options: OpenCapabilitySessionOptions): Promise<CapabilitySession>;
}

export type CapabilityLogSink = (entry: {
  level: 'debug' | 'info' | 'warn' | 'error';
  connectorId: string;
  message: string;
}) => void;

