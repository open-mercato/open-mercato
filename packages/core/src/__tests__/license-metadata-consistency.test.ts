import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import fg from 'fast-glob'

/**
 * License-metadata consistency guard (#3475).
 *
 * Open Mercato is open-core: the root LICENSE is MIT and every workspace
 * package ships under it, EXCEPT `@open-mercato/enterprise`, the single
 * commercial package (its own LICENSE.md + restricted publishConfig). The
 * `ModuleInfo.license` / `IntegrationDefinition.license` strings are
 * descriptive metadata only and are NOT the OSS-vs-proprietary boundary — the
 * PACKAGE is.
 *
 * Those metadata strings had drifted: ~28 OSS module/integration manifests
 * hardcoded `license: 'Proprietary'` (copy-paste legacy) even though their
 * packages are MIT, which misled adopters into thinking core needed a
 * commercial license. This guard pins the corrected invariant so the drift
 * cannot silently return on new modules:
 *
 *   1. No metadata file OUTSIDE packages/enterprise/ may declare
 *      `license: 'Proprietary'`.
 *   2. The known commercial enterprise modules MUST keep declaring it, so an
 *      accidental flip to MIT in the commercial package also fails here.
 */

const repoRoot = join(__dirname, '..', '..', '..', '..')

const metadataFiles = fg.sync(
  ['packages/*/src/modules/**/index.ts', 'packages/*/src/modules/**/integration.ts'],
  {
    cwd: repoRoot,
    absolute: true,
    ignore: ['**/node_modules/**', '**/dist/**', '**/__tests__/**', '**/__mocks__/**'],
  },
)

const licenseOf = (file: string): string | null => {
  const match = readFileSync(file, 'utf8').match(/license:\s*'([^']+)'/)
  return match ? match[1] : null
}

const isEnterprise = (file: string): boolean =>
  relative(repoRoot, file).split(sep).join('/').startsWith('packages/enterprise/')

describe('license metadata consistency (#3475)', () => {
  it('discovers module/integration metadata files', () => {
    expect(metadataFiles.length).toBeGreaterThan(0)
  })

  it('no OSS-package metadata declares a proprietary license', () => {
    const offenders = metadataFiles
      .filter((file) => !isEnterprise(file))
      .filter((file) => licenseOf(file) === 'Proprietary')
      .map((file) => relative(repoRoot, file).split(sep).join('/'))

    expect(offenders).toEqual([])
  })

  it('keeps the commercial enterprise modules marked proprietary', () => {
    const enterpriseCommercial = [
      'packages/enterprise/src/modules/record_locks/index.ts',
      'packages/enterprise/src/modules/system_status_overlays/index.ts',
    ]
    for (const rel of enterpriseCommercial) {
      expect(licenseOf(join(repoRoot, rel))).toBe('Proprietary')
    }
  })
})
