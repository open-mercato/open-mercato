import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';
import type { AgentRunResult } from '../src/contracts.js';
import type { BusinessAgentRuntime, RunOptions } from '../src/runtime/runtime.js';
import { runHarnessStdio } from '../src/stdio.js';

test('stdio runtime emits ordered NDJSON events followed by one result', async () => {
  const output = captureOutput();
  const runtime: Pick<BusinessAgentRuntime, 'run'> = {
    async run(input: unknown, options: RunOptions = {}) {
      assert.deepEqual(input, { protocolVersion: '1', runId: 'run-stdio' });
      await options.onEvent?.({
        type: 'run.started',
        runId: 'run-stdio',
        timestamp: '2026-08-31T10:00:00.000Z',
      });
      return makeResult();
    },
  };

  const outcome = await runHarnessStdio({
    runtime,
    input: Readable.from([JSON.stringify({ protocolVersion: '1', runId: 'run-stdio' })]),
    output: output.stream,
  });

  assert.equal(outcome, 'completed');
  assert.deepEqual(output.records(), [
    {
      kind: 'event',
      event: {
        type: 'run.started',
        runId: 'run-stdio',
        timestamp: '2026-08-31T10:00:00.000Z',
      },
    },
    { kind: 'result', result: makeResult() },
  ]);
});

test('stdio runtime returns a public error for invalid JSON without calling the runtime', async () => {
  const output = captureOutput();
  const runtime: Pick<BusinessAgentRuntime, 'run'> = {
    async run() {
      throw new Error('runtime must not be called');
    },
  };

  const outcome = await runHarnessStdio({
    runtime,
    input: Readable.from(['{invalid']),
    output: output.stream,
  });

  assert.equal(outcome, 'failed');
  assert.deepEqual(output.records(), [
    {
      kind: 'error',
      error: { code: 'INVALID_REQUEST', message: 'stdin must contain one valid JSON request' },
    },
  ]);
});

test('stdio runtime enforces its input byte limit before calling the runtime', async () => {
  const output = captureOutput();
  let called = false;
  const runtime: Pick<BusinessAgentRuntime, 'run'> = {
    async run() {
      called = true;
      return makeResult();
    },
  };

  const outcome = await runHarnessStdio({
    runtime,
    input: Readable.from(['12345']),
    output: output.stream,
    maxInputBytes: 4,
  });

  assert.equal(outcome, 'failed');
  assert.equal(called, false);
  assert.equal(output.records()[0]?.error.code, 'INVALID_REQUEST');
});

function captureOutput(): { stream: Writable; records: () => any[] } {
  let value = '';
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        value += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        callback();
      },
    }),
    records: () =>
      value
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
  };
}

function makeResult(): AgentRunResult {
  return {
    protocolVersion: '1',
    status: 'completed',
    identity: {
      runId: 'run-stdio',
      agentId: 'agent-stdio',
      agentVersion: '1',
      agentDigest: '0123456789abcdef',
      runtimeProfile: 'business-v1',
      model: {
        bindingId: 'model-primary',
        bindingRevision: '1',
        driver: 'openai',
        modelId: 'gpt-5-mini',
      },
      connectors: [],
      toolCatalogDigest: 'empty',
    },
    output: { decision: 'approve' },
    usage: { totalTokens: 10 },
    steps: 1,
    toolCalls: 0,
    durationMs: 25,
  };
}
