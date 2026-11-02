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

// A deliberate allowlist, not every volume in compose: `init_marker`, `mcp_shared` and
// `localstack_data` hold no user data worth backing up. A new user-data volume must be added here.
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

test('full-app docs restore into an empty database with the app stopped', async () => {
  for (const [docName, doc] of Object.entries(await readFullAppDocs())) {
    const restoreAt = doc.indexOf(`| ${COMPOSE_COMMAND} exec -T postgres psql`);
    const steps = [
      `${COMPOSE_COMMAND} stop app mcp documents-collab`,
      `${COMPOSE_COMMAND} exec -T postgres dropdb -U postgres --if-exists open-mercato`,
      `${COMPOSE_COMMAND} exec -T postgres createdb -U postgres open-mercato`,
    ];
    for (const step of steps) {
      const stepAt = doc.indexOf(step);
      assert.ok(stepAt >= 0 && stepAt < restoreAt, `${docName} must run \`${step}\` before the restore`);
    }
    assert.ok(
      doc.indexOf(`${COMPOSE_COMMAND} up -d app mcp`) > restoreAt,
      `${docName} must start the app again after the restore`,
    );
  }
});

test('full-app docs restore the file the backup command writes', async () => {
  for (const [docName, doc] of Object.entries(await readFullAppDocs())) {
    const written = doc.match(/exec -T postgres pg_dump -U postgres open-mercato > (.+)$/m);
    const restored = doc.match(/cat (\S+) \| docker compose/);
    assert.ok(written && restored, `${docName} must show both the backup and the restore command`);
    assert.equal(
      restored[1],
      written[1].replace('$(date +%Y%m%d)', 'YYYYMMDD'),
      `${docName} must restore the file its backup command writes`,
    );
  }
});
