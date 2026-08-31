let input = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) input += chunk

if (process.argv[2] !== 'run' || process.argv[3] !== '--stdio') {
  process.stderr.write('unexpected command\n')
  process.exitCode = 2
} else {
  const bundle = JSON.parse(input)
  process.stdout.write(`${JSON.stringify({
    kind: 'event',
    event: {
      type: 'run.started',
      runId: bundle.runId,
      timestamp: '2026-08-31T10:00:00.000Z',
    },
  })}\n`)
  process.stdout.write(`${JSON.stringify({
    kind: 'result',
    result: {
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
          driver: bundle.agent.model.driver,
          modelId: bundle.agent.model.modelId,
        },
        connectors: [],
        toolCatalogDigest: 'fake',
      },
      output: { inheritedSecret: Boolean(process.env.OM_TEST_LONG_SECRET) },
      usage: {},
      steps: 1,
      toolCalls: 0,
      durationMs: 1,
    },
  })}\n`)
}
