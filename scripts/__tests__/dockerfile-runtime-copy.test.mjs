import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))

async function collectPackageManifests(relativeDir) {
  const root = path.join(repoRoot, relativeDir)
  const manifests = []

  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const manifest = path.join(root, entry.name, 'package.json')
    try {
      await readFile(manifest)
      manifests.push(path.relative(repoRoot, manifest).split(path.sep).join('/'))
    } catch {
      // Not a workspace package.
    }
  }

  return manifests.sort()
}

test('production Dockerfile avoids duplicating the generated Next output layer', async () => {
  const dockerfile = await readFile(new URL('../../Dockerfile', import.meta.url), 'utf8')

  assert.match(
    dockerfile,
    /COPY --from=builder \/app\/apps\/mercato\/\.mercato\/next \.\/apps\/mercato\/\.mercato\/next/,
  )
  assert.match(
    dockerfile,
    /COPY --from=builder \/app\/apps\/mercato\/\.mercato\/generated \.\/apps\/mercato\/\.mercato\/generated/,
  )
  assert.doesNotMatch(
    dockerfile,
    /COPY --from=builder \/app\/apps\/mercato\/\.mercato \.\/apps\/mercato\/\.mercato/,
  )
})

test('Dockerfile installs dependencies from workspace manifests before copying source files', async () => {
  const dockerfile = await readFile(new URL('../../Dockerfile', import.meta.url), 'utf8')
  const manifests = [
    ...(await collectPackageManifests('apps')),
    ...(await collectPackageManifests('packages')),
  ]

  for (const manifest of manifests) {
    const destination = `./${path.posix.dirname(manifest)}/`
    assert.ok(
      dockerfile.includes(`COPY ${manifest} ${destination}`),
      `Dockerfile should copy ${manifest} before the full source copy`,
    )
  }

  const documentsManifestCopies = dockerfile.match(
    /(?:COPY|COPY --from=builder) (?:\/app\/)?packages\/documents\/package\.json \.\/packages\/documents\//g,
  ) ?? []
  assert.equal(
    documentsManifestCopies.length,
    3,
    'Dockerfile should copy the Documents manifest in builder, dev, and runner stages',
  )

  const manifestCopyIndex = dockerfile.indexOf('COPY packages/shared/package.json ./packages/shared/')
  const installIndex = dockerfile.indexOf('RUN yarn install --immutable')
  const sourceCopyIndex = dockerfile.indexOf('COPY packages/ ./packages/')

  assert.ok(manifestCopyIndex >= 0, 'expected a workspace package manifest copy')
  assert.ok(installIndex > manifestCopyIndex, 'expected immutable install after manifest copies')
  assert.ok(sourceCopyIndex > installIndex, 'expected full source copy after immutable install')
  assert.doesNotMatch(dockerfile, /^RUN yarn install$/m)
})

test('production runtime image supports Chromium for Documents PDF export', async () => {
  const dockerfile = await readFile(new URL('../../Dockerfile', import.meta.url), 'utf8')

  assert.match(dockerfile, /PUPPETEER_EXECUTABLE_PATH=\/usr\/bin\/chromium/)
  assert.match(dockerfile, /apk add --no-cache ca-certificates chromium openssl postgresql-client sudo/)
})

test('production runtime Chromium install is opt-in via INSTALL_CHROMIUM build arg', async () => {
  const dockerfile = await readFile(new URL('../../Dockerfile', import.meta.url), 'utf8')

  assert.match(dockerfile, /ARG INSTALL_CHROMIUM=0/, 'runner stage should default INSTALL_CHROMIUM to 0')
  assert.match(
    dockerfile,
    /if \[ "\$INSTALL_CHROMIUM" = "1" \]; then[\s\S]*?apk add --no-cache ca-certificates chromium openssl postgresql-client sudo/,
    'chromium install should be guarded by the INSTALL_CHROMIUM build arg',
  )
  assert.match(
    dockerfile,
    /else[\s\S]*?apk add --no-cache ca-certificates openssl postgresql-client sudo/,
    'opting out must still install the non-chromium runtime packages',
  )
})

test('production Docker stage includes the telemetry workspace before focusing dependencies', async () => {
  const dockerfile = await readFile(new URL('../../Dockerfile', import.meta.url), 'utf8')
  const telemetryManifestIndex = dockerfile.indexOf(
    'COPY --from=builder /app/packages/telemetry/package.json ./packages/telemetry/',
  )
  const productionFocusIndex = dockerfile.indexOf('RUN yarn workspaces focus @open-mercato/app --production')

  assert.ok(telemetryManifestIndex >= 0, 'expected telemetry workspace manifest in the production stage')
  assert.ok(productionFocusIndex > telemetryManifestIndex, 'expected telemetry manifest before production focus')
})
