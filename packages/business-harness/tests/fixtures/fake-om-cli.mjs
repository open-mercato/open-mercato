import readline from 'node:readline';

const input = readline.createInterface({ input: process.stdin });

input.on('line', (line) => {
  const request = JSON.parse(line);
  let result;
  if (request.method === 'initialize') {
    result = { protocolVersion: '1', server: { name: 'fake-om-cli', version: '1' } };
  } else if (request.method === 'tools/list') {
    result = {
      tools: [
        {
          name: 'customers.get',
          description: 'Read a customer',
          inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
          annotations: { readOnlyHint: true },
        },
      ],
    };
  } else if (request.method === 'tools/call') {
    result = { toolResult: { id: request.params.arguments.id, credential: process.env.OM_TEST_TOKEN } };
  } else if (request.method === 'shutdown') {
    result = { ok: true };
    setTimeout(() => process.exit(0), 0);
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
});

