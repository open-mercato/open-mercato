import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  businessAgentRuntimeCliPath,
  businessAgentRuntimeHostConfigPath,
} from '../src/bin-path.js';

test('resolves one-off runtime files relative to the package instead of process cwd', () => {
  assert.equal(path.basename(businessAgentRuntimeCliPath), 'cli.js');
  assert.equal(path.basename(path.dirname(businessAgentRuntimeCliPath)), 'dist');
  assert.equal(path.basename(businessAgentRuntimeHostConfigPath), 'harness.config.host.json');
  assert.equal(
    path.dirname(businessAgentRuntimeHostConfigPath),
    path.dirname(path.dirname(businessAgentRuntimeCliPath)),
  );
});
