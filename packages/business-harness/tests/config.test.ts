import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadProcessConfig, loadRuntimeProcessConfig } from '../src/config.js';

const configFile = fileURLToPath(new URL('../harness.config.host.json', import.meta.url));

test('one-off runtime configuration does not require an HTTP service token', async () => {
  const config = await loadRuntimeProcessConfig({
    HARNESS_CONFIG_FILE: configFile,
    HARNESS_CREDENTIAL_MODE: 'env',
  });

  assert.equal(config.credentialMode, 'env');
  assert.equal(config.harness.connectors['open-mercato']?.driver, 'mcp-http');
});

test('HTTP server configuration still requires its service token', async () => {
  await assert.rejects(
    () =>
      loadProcessConfig({
        HARNESS_CONFIG_FILE: configFile,
        HARNESS_CREDENTIAL_MODE: 'env',
      }),
    /HARNESS_SERVICE_TOKEN is required/,
  );
});

test('HTTP server configuration rejects a service token published in this repository', async () => {
  // The compose files ship this value as a local convenience. Reaching a shared or
  // production deployment with it means anyone who has read the repo can POST /v1/runs.
  await assert.rejects(
    () =>
      loadProcessConfig({
        HARNESS_CONFIG_FILE: configFile,
        HARNESS_CREDENTIAL_MODE: 'env',
        HARNESS_SERVICE_TOKEN: 'open-mercato-business-harness-local-token',
      }),
    /placeholder published in this repository/,
  );
});

test('HTTP server configuration accepts the placeholder only behind an explicit opt-in', async () => {
  const config = await loadProcessConfig({
    HARNESS_CONFIG_FILE: configFile,
    HARNESS_CREDENTIAL_MODE: 'env',
    HARNESS_SERVICE_TOKEN: 'open-mercato-business-harness-local-token',
    HARNESS_ALLOW_INSECURE_TOKEN: 'true',
  });

  assert.equal(config.serviceToken, 'open-mercato-business-harness-local-token');
});

test('HTTP server configuration still rejects a short service token', async () => {
  await assert.rejects(
    () =>
      loadProcessConfig({
        HARNESS_CONFIG_FILE: configFile,
        HARNESS_CREDENTIAL_MODE: 'env',
        HARNESS_SERVICE_TOKEN: 'too-short',
      }),
    /at least 24 characters/,
  );
});
