import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// Root duplicates exist only so pre-starters/docker deployments keep working;
// the starters/docker file is canonical. Remove this map (and the root files)
// when the backwards-compatibility window closes.
const ROOT_DUPLICATES = {
  'docker-compose.yml': 'starters/docker/compose.infra.yml',
  'docker-compose.fullapp.yml': 'starters/docker/compose.fullapp.yml',
  'docker-compose.fullapp.dev.yml': 'starters/docker/compose.fullapp.dev.yml',
  'docker-compose.fullapp.traefik.yml': 'starters/docker/compose.fullapp.traefik.yml',
  'docker-compose.fullapp.traefik.dev.yml': 'starters/docker/compose.fullapp.traefik.dev.yml',
  'docker-compose.preview.yaml': 'starters/docker/compose.preview.yml',
}

function expectedHeader(canonical) {
  return (
    `# Backwards-compatibility duplicate of ${canonical} — the canonical file\n` +
    '# lives there; edit that one. scripts/__tests__/root-compose-backcompat.test.mjs\n' +
    '# enforces byte equality with the source.\n\n'
  )
}

for (const [rootName, canonical] of Object.entries(ROOT_DUPLICATES)) {
  test(`root ${rootName} stays in sync with ${canonical}`, () => {
    const rootPath = path.resolve(ROOT, rootName)
    assert.ok(fs.existsSync(rootPath), `${rootName} is missing at the repo root`)
    const rootContent = fs.readFileSync(rootPath, 'utf8')
    const canonicalContent = fs.readFileSync(path.resolve(ROOT, canonical), 'utf8')
    assert.strictEqual(
      rootContent,
      expectedHeader(canonical) + canonicalContent,
      `${rootName} diverged from ${canonical} — after editing the canonical file, regenerate the root duplicate (copy the file and keep its 4-line header)`
    )
  })
}
