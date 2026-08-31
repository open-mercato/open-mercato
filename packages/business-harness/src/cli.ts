#!/usr/bin/env node
import { CapabilityGateway } from './capabilities/gateway.js';
import {
  loadProcessConfig,
  loadRuntimeProcessConfig,
  type RuntimeProcessConfig,
} from './config.js';
import { BrokerCredentialResolver, EnvironmentCredentialResolver } from './credentials/lease-client.js';
import type { CredentialResolver } from './credentials/types.js';
import { HarnessError, publicError } from './errors.js';
import { DefaultModelResolver } from './models/resolver.js';
import { VercelAiAgentEngine } from './runtime/engine.js';
import { BusinessAgentRuntime } from './runtime/runtime.js';
import { createHarnessHttpServer } from './server.js';
import { runHarnessStdio, writeStdioRecord } from './stdio.js';

async function main(): Promise<void> {
  const [command = 'serve', ...args] = process.argv.slice(2);
  if (command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(usage());
    return;
  }
  if (command === 'run' && args.length === 1 && args[0] === '--stdio') {
    await runStdioCommand();
    return;
  }
  if (command !== 'serve' || args.length > 0) {
    throw new HarnessError('CONFIGURATION_ERROR', `Invalid command.\n\n${usage()}`);
  }
  await serveHttp();
}

async function serveHttp(): Promise<void> {
  const config = await loadProcessConfig();
  const runtime = createRuntime(config);
  const server = createHarnessHttpServer({ runtime, serviceToken: config.serviceToken });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => resolve());
  });
  process.stdout.write(
    `${JSON.stringify({
      level: 'info',
      message: 'Business agent runtime is listening',
      host: config.host,
      port: config.port,
    })}\n`,
  );

  const shutdown = () => {
    server.close((error) => {
      if (error) {
        process.stderr.write(`${JSON.stringify({ level: 'error', error: publicError(error) })}\n`);
        process.exitCode = 1;
      }
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

async function runStdioCommand(): Promise<void> {
  const abortController = new AbortController();
  const abort = () => {
    abortController.abort(new DOMException('Runtime process was terminated', 'AbortError'));
  };
  process.once('SIGTERM', abort);
  process.once('SIGINT', abort);
  try {
    const config = await loadRuntimeProcessConfig();
    const outcome = await runHarnessStdio({
      runtime: createRuntime(config),
      input: process.stdin,
      output: process.stdout,
      signal: abortController.signal,
    });
    process.exitCode = outcome === 'completed' ? 0 : 1;
  } catch (error) {
    await writeStdioRecord(process.stdout, { kind: 'error', error: publicError(error) });
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGTERM', abort);
    process.removeListener('SIGINT', abort);
  }
}

function createRuntime(config: RuntimeProcessConfig): BusinessAgentRuntime {
  const credentials: CredentialResolver =
    config.credentialMode === 'broker'
      ? new BrokerCredentialResolver(config.credentialBrokerUrl as string)
      : new EnvironmentCredentialResolver(config.environmentCredentialMap);
  const capabilities = new CapabilityGateway(config.harness, credentials, {
    log: ({ level, connectorId, message }) => {
      process.stderr.write(
        `${JSON.stringify({ timestamp: new Date().toISOString(), level, connectorId, message })}\n`,
      );
    },
  });
  const runtime = new BusinessAgentRuntime({
    config: config.harness,
    capabilities,
    modelResolver: new DefaultModelResolver(credentials),
    engine: new VercelAiAgentEngine(),
  });
  return runtime;
}

function usage(): string {
  return [
    'Usage:',
    '  om-business-harness serve',
    '  om-business-harness run --stdio',
    '',
  ].join('\n');
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ level: 'error', error: publicError(error) })}\n`);
  process.exitCode = 1;
});
