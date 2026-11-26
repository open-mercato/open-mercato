import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const dockerfile = fs.readFileSync(path.join(repositoryRoot, 'Dockerfile'), 'utf8')
const runnerStage = dockerfile.slice(dockerfile.lastIndexOf('FROM recovery-tools AS runner'))

test('production runner includes the app runtime CLI launcher', () => {
  const launcherPath = path.join(repositoryRoot, 'apps/mercato/scripts/mercato-cli.mjs')

  assert.ok(fs.existsSync(launcherPath), 'the runtime CLI launcher must exist in the app source')
  assert.match(
    runnerStage,
    /COPY --from=builder \/app\/apps\/mercato\/scripts \.\/apps\/mercato\/scripts/,
    'the production runner must copy the app scripts directory',
  )
})

function stage(source, name) {
  const marker = new RegExp(`^FROM .+ AS ${name}$`, 'm')
  const match = marker.exec(source)
  assert.ok(match, `missing ${name} image stage`)
  const rest = source.slice(match.index + match[0].length)
  return rest.split(/^FROM /m)[0]
}

test('monorepo maintenance image is self-contained without the web-builder dependency', () => {
  const maintenance = stage(dockerfile, 'maintenance')
  assert.match(maintenance, /COPY --from=dev-build --chown=1001:1001 \/app \/app/)
  assert.doesNotMatch(maintenance, /--from=builder|yarn build|next build/)
  assert.match(maintenance, /USER 1001:1001[\s\S]*RUN --network=none node \/app\/(?:apps\/mercato\/)?scripts\/mercato-cli\.mjs entities --help/)
  assert.match(maintenance, /ENTRYPOINT \["\/usr\/local\/bin\/om-recovery"\]/)
  assert.match(maintenance, /CMD \["node", "\/app\/packages\/enterprise\/bin\/mercato-backup\.mjs", "--help"\]/)
})

test('standalone maintenance uses generated published modules before the separate Next build', () => {
  const template = fs.readFileSync(path.join(repositoryRoot, 'packages/create-app/template/Dockerfile'), 'utf8')
  const modules = stage(template, 'module-build')
  const maintenance = stage(template, 'maintenance')
  assert.match(modules, /RUN yarn install/)
  assert.match(modules, /RUN yarn generate/)
  assert.doesNotMatch(modules, /yarn build|next build/)
  assert.match(template, /^FROM module-build AS builder$/m)
  assert.match(stage(template, 'builder'), /RUN NODE_ENV=production yarn build/)
  assert.match(maintenance, /COPY --from=module-build --chown=1001:1001 \/app \/app/)
  assert.match(maintenance, /USER 1001:1001[\s\S]*RUN --network=none node \/app\/(?:apps\/mercato\/)?scripts\/mercato-cli\.mjs entities --help/)
  assert.match(maintenance, /ENTRYPOINT \["\/usr\/local\/bin\/om-recovery"\]/)
  assert.match(maintenance, /CMD \["node", "\/app\/node_modules\/@open-mercato\/enterprise\/bin\/mercato-backup\.mjs", "--help"\]/)
})

test('web builders retain the 8 GiB Next TypeScript heap with an explicit build-argument override', () => {
  const template = fs.readFileSync(path.join(repositoryRoot, 'packages/create-app/template/Dockerfile'), 'utf8')
  for (const source of [dockerfile, template]) {
    const web = stage(source, 'builder')
    assert.match(web, /ARG OM_BUILD_NODE_OPTIONS="--max-old-space-size=8192"/)
    assert.match(web, /OM_BUILD_NODE_OPTIONS=\$\{OM_BUILD_NODE_OPTIONS\}/)
    assert.match(web, /RUN (?:NODE_ENV=production )?yarn build\b/)
    assert.doesNotMatch(web, /OM_BUILD_NODE_OPTIONS="--max-old-space-size=4096"/)
  }
  const packages = stage(dockerfile, 'dev-build')
  assert.match(packages, /OM_BUILD_NODE_OPTIONS="--max-old-space-size=4096"/)
  assert.match(packages, /RUN yarn build:packages && yarn generate && yarn build:packages/)
  assert.doesNotMatch(stage(dockerfile, 'maintenance'), /OM_BUILD_NODE_OPTIONS|next build/)
  assert.doesNotMatch(stage(template, 'module-build'), /OM_BUILD_NODE_OPTIONS|next build/)
})

for (const composePath of [
  'docker-compose.fullapp.yml',
  'docker-compose.fullapp.dev.yml',
  'starters/docker/compose.fullapp.yml',
  'starters/docker/compose.fullapp.dev.yml',
  'packages/create-app/template/docker-compose.fullapp.yml',
  'packages/create-app/template/docker-compose.fullapp.dev.yml',
]) {
  test(`${composePath} keeps recovery custody out of application services`, () => {
    const compose = fs.readFileSync(path.join(repositoryRoot, composePath), 'utf8')
    const services = compose.split(/^volumes:/m)[0]
    assert.doesNotMatch(services, /recovery_data|\/var\/lib\/open-mercato\/recovery/)
    assert.match(compose, /^  recovery_data:/m)
  })
}

for (const composePath of [
  'starters/docker/compose.recovery.yml',
  'packages/create-app/template/docker-compose.recovery.yml',
]) {
  test(`${composePath} preserves isolated maintenance access to persistent custody`, () => {
    const compose = fs.readFileSync(path.join(repositoryRoot, composePath), 'utf8')
    assert.match(compose, /^  maintenance:/m)
    assert.match(compose, /profiles: \[recovery\]/)
    assert.match(compose, /user: "1001:1001"/)
    assert.match(compose, /recovery_data:\/var\/lib\/open-mercato\/recovery/)
    assert.match(compose, /cap_drop: \[ALL\]/)
    assert.match(compose, /no-new-privileges:true/)
    assert.match(compose, /read_only: true/)
  })
}
