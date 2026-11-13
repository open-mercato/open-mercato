import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// #5773: a fresh clone's setup docs never mentioned `yarn install-skills`, so contributors using
// an AI coding agent could miss the shared skill collection entirely. This pins the command names
// these docs reference to the scripts actually defined in package.json, so a rename or removal of
// either script fails this test instead of silently going stale in prose.
const repoRootPackageJsonUrl = new URL('../../../package.json', import.meta.url);
const setupDocUrl = new URL('../docs/installation/setup.mdx', import.meta.url);
const readmeUrl = new URL('../../../README.md', import.meta.url);

// Every guide that walks a contributor through a fresh-clone bootstrap has to mention the step —
// covering only setup.mdx would leave the #5773 failure mode reachable through the monorepo and
// WSL2 guides, which carry their own complete `yarn install` → `yarn initialize` sequences.
const freshCloneGuideUrls = [
  setupDocUrl,
  new URL('../docs/installation/monorepo.mdx', import.meta.url),
  new URL('../docs/installation/wsl2.mdx', import.meta.url),
];

// The Docker track never runs a bare `yarn install`, so it reaches the same failure mode through
// the `yarn docker:*` wrapper list instead. Nothing in the Docker setup installs skills implicitly
// (unlike the dev container, whose post-create hook runs the installer), so that list has to
// enumerate the wrapper the same way setup.mdx does.
const dockerGuideUrl = new URL('../docs/installation/docker.mdx', import.meta.url);

test('setup docs and README reference real install-skills scripts', async () => {
  const packageJson = JSON.parse(await readFile(repoRootPackageJsonUrl, 'utf8'));
  assert.ok(
    packageJson.scripts?.['install-skills'],
    'package.json must keep an `install-skills` script for these docs to point at',
  );
  assert.ok(
    packageJson.scripts?.['docker:install-skills'],
    'package.json must keep a `docker:install-skills` script for these docs to point at',
  );

  const setupDoc = await readFile(setupDocUrl, 'utf8');
  assert.match(
    setupDoc,
    /yarn install-skills/,
    'setup.mdx must document `yarn install-skills` in the native fresh-clone flow',
  );
  assert.match(
    setupDoc,
    /yarn docker:install-skills/,
    'setup.mdx must document the `yarn docker:install-skills` container equivalent',
  );

  const readme = await readFile(readmeUrl, 'utf8');
  assert.match(
    readme,
    /yarn install-skills/,
    'README.md AI-engineering section must reference the repo-specific `yarn install-skills` command',
  );
});

// #5773 also asks the docs to say that the manual step is a deliberate design decision, not an
// oversight, so nobody "fixes" it by wiring the network-bound install into every `yarn install`.
test('setup docs record that the skill install is intentionally not a postinstall hook', async () => {
  const setupDoc = await readFile(setupDocUrl, 'utf8');
  assert.match(
    setupDoc,
    /postinstall/,
    'setup.mdx must name `postinstall` when explaining why the skill install stays manual',
  );
  assert.match(
    setupDoc,
    /(intentionally|deliberately)[^.]*\bmanual\b|\bmanual\b[^.]*(intentionally|deliberately)/,
    'setup.mdx must state that keeping the skill install manual is intentional',
  );
});

test('every fresh-clone bootstrap guide mentions the agent-skills step', async () => {
  for (const guideUrl of freshCloneGuideUrls) {
    const guide = await readFile(guideUrl, 'utf8');
    const guideName = guideUrl.pathname.split('/').pop();
    assert.match(
      guide,
      /yarn install-skills/,
      `${guideName} walks a contributor through a fresh-clone bootstrap, so it must mention \`yarn install-skills\``,
    );
    assert.match(
      guide,
      /only if you use an AI coding agent|if you do not use/,
      `${guideName} must mark the agent-skills step as optional, so contributors who use no coding agent can skip it`,
    );
  }
});

test('the Docker guide lists the container equivalent in its wrapper commands', async () => {
  const dockerGuide = await readFile(dockerGuideUrl, 'utf8');
  assert.match(
    dockerGuide,
    /yarn docker:install-skills/,
    'docker.mdx enumerates the `yarn docker:*` wrappers, so it must list `yarn docker:install-skills`',
  );
  assert.match(
    dockerGuide,
    /only if you use an AI coding agent|if you do not use/,
    'docker.mdx must mark the agent-skills wrapper as optional',
  );
});
