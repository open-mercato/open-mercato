import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the Docs test task raises the heap limit for the build only', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const commands = manifest.scripts.test.split(' && ');

  assert.deepEqual(
    commands.filter((command) => command.includes('NODE_OPTIONS')),
    ['cross-env NODE_OPTIONS=--max-old-space-size=2048 yarn build'],
  );
});
