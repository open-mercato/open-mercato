import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// #7651: the full-app Docker docs told users to back up with `docker exec mercato-postgres …` and
// listed `mercato-postgres-data`, but compose.fullapp.yml suffixes every container and volume with
// `-${DEPLOY_ENV:-local}`, so the copied commands failed with "No such container". This pins the
// documented volume names and the backup target to the compose file instead of to memory.
const composeUrl = new URL('../../../starters/docker/compose.fullapp.yml', import.meta.url);
const vpsDocUrl = new URL('../docs/installation/vps.mdx', import.meta.url);
const setupDocUrl = new URL('../docs/installation/setup.mdx', import.meta.url);

const DOCUMENTED_VOLUMES = ['postgres_data', 'redis_data', 'meilisearch_data', 'attachments_storage'];
const COMPOSE_COMMAND = 'docker compose --project-directory . -f starters/docker/compose.fullapp.yml';

function readVolumeName(compose, volumeKey) {
  const match = compose.match(new RegExp(`^  ${volumeKey}:\\n    name: (\\S+)$`, 'm'));
  assert.ok(match, `compose.fullapp.yml must declare a named \`${volumeKey}\` volume`);
  return match[1].replace('${DEPLOY_ENV:-local}', 'local');
}

// setup.mdx also documents the infra-only compose stack, where `mercato-postgres` is the real
// container name, so only its full-app section is held to the full-app compose file.
async function readFullAppDocs() {
  const vps = await readFile(vpsDocUrl, 'utf8');
  const setup = await readFile(setupDocUrl, 'utf8');
  const start = setup.indexOf('## Docker Deployment (Full Stack)');
  assert.ok(start >= 0, 'setup.mdx must keep its "Docker Deployment (Full Stack)" section');
  const end = setup.indexOf('\n## ', start + 1);
  return { 'vps.mdx': vps, 'setup.mdx (full stack)': setup.slice(start, end === -1 ? undefined : end) };
}

test('full-app docs list the volume names compose.fullapp.yml creates by default', async () => {
  const compose = await readFile(composeUrl, 'utf8');
  const volumeNames = DOCUMENTED_VOLUMES.map((volumeKey) => readVolumeName(compose, volumeKey));
  for (const [docName, doc] of Object.entries(await readFullAppDocs())) {
    for (const volumeName of volumeNames) {
      assert.ok(doc.includes(`\`${volumeName}\``), `${docName} must list the \`${volumeName}\` volume`);
    }
  }
});

test('full-app docs reach PostgreSQL through the compose service, not a container name', async () => {
  const compose = await readFile(composeUrl, 'utf8');
  assert.match(compose, /^  postgres:\n/m, 'compose.fullapp.yml must keep a `postgres` service');
  for (const [docName, doc] of Object.entries(await readFullAppDocs())) {
    assert.doesNotMatch(
      doc,
      /docker exec(?: -i)? mercato-postgres\b/,
      `${docName} must not target a hard-coded container name; it carries the DEPLOY_ENV suffix`,
    );
    assert.ok(
      doc.includes(`${COMPOSE_COMMAND} exec -T postgres pg_dump`),
      `${docName} must back up with \`${COMPOSE_COMMAND} exec -T postgres pg_dump\``,
    );
    assert.ok(
      doc.includes(`| ${COMPOSE_COMMAND} exec -T postgres psql`),
      `${docName} must restore by piping into \`${COMPOSE_COMMAND} exec -T postgres psql\``,
    );
  }
});
