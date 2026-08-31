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
