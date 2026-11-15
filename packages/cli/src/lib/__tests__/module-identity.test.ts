import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getEnabledModuleIdentities, getModuleLocators } from '../module-identity'
import { resolveModuleRequirement } from '@open-mercato/shared/modules/module-locators'
import type { PackageResolver } from '../resolver'

describe('module source identities', () => {
  let root: string
  let resolver: PackageResolver
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'module-identities-'))
    fs.mkdirSync(path.join(root, 'package'), { recursive: true })
    fs.mkdirSync(path.join(root, 'module'), { recursive: true })
    resolver = {
      getPackageRoot: () => path.join(root, 'package'),
      getAppDir: () => root,
      getModulePaths: () => ({ appBase: path.join(root, 'module'), pkgBase: path.join(root, 'package') }),
    } as PackageResolver
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  function packageManifest(repository: unknown = 'https://github.com/pkarw/consents.git', name = '@pkarw/marketing_consents'): void {
    fs.writeFileSync(path.join(root, 'package', 'package.json'), JSON.stringify({ name, repository }))
  }

  function dependency(specifier: string, binding = '@pkarw/marketing_consents'): void {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { [binding]: specifier } }))
  }

  it.each(['1.2.3', 'beta-tag', '^1.0.0', '~1.2.0'])('keeps npm dependency %s distinct from its repository', (version) => {
    packageManifest()
    dependency(version)
    const locators = getModuleLocators({ id: 'marketing_consents', from: '@pkarw/marketing_consents' }, resolver)
    expect(locators).toEqual(['npm:@pkarw/marketing_consents'])
    expect(resolveModuleRequirement('github:pkarw/consents', [{ id: 'marketing_consents', locators }])).toBeUndefined()
  })

  it.each(['github:pkarw/consents#commit', 'pkarw/consents#main', 'https://github.com/pkarw/consents.git#commit'])('observes GitHub source %s without treating the package name as npm origin', (specifier) => {
    packageManifest('https://github.com/other/consents')
    dependency(specifier)
    const locators = getModuleLocators({ id: 'marketing_consents', from: '@pkarw/marketing_consents' }, resolver)
    expect(locators).toEqual(['github:pkarw/consents'])
    expect(resolveModuleRequirement('npm:@pkarw/marketing_consents', [{ id: 'marketing_consents', locators }])).toBeUndefined()
  })

  it.each(['github:stale/consents', 'npm:@pkarw/marketing_consents'])('rejects declaration %s that contradicts observed GitHub source', (locator) => {
    packageManifest()
    dependency('github:pkarw/consents#commit')
    expect(() => getModuleLocators({ id: 'marketing_consents', from: '@pkarw/marketing_consents', locator }, resolver)).toThrow(/declared origin.*disagrees with observed origin/)
  })

  it('rejects a GitHub declaration over an observed npm dependency', () => {
    packageManifest()
    dependency('1.2.3')
    expect(() => getModuleLocators({ id: 'marketing_consents', from: '@pkarw/marketing_consents', locator: 'github:pkarw/consents' }, resolver)).toThrow(/disagrees with observed origin/)
  })

  it.each(['file:../consents', 'workspace:*', 'link:../consents'])('keeps unobserved source unknown for %s', (specifier) => {
    packageManifest()
    dependency(specifier)
    fs.writeFileSync(path.join(root, 'package', 'index.ts'), "export const metadata = { locator: 'github:pkarw/consents' }")
    expect(getModuleLocators({ id: 'marketing_consents', from: '@pkarw/marketing_consents' }, resolver)).toEqual([])
  })

  it('does not invent install provenance from package repository or metadata alone', () => {
    packageManifest()
    fs.writeFileSync(path.join(root, 'package', 'index.ts'), "export const metadata = { locator: 'github:pkarw/consents' }")
    expect(getModuleLocators({ id: 'marketing_consents', from: '@pkarw/marketing_consents' }, resolver)).toEqual([])
  })

  it('keeps retained registration provenance when dependency evidence is absent', () => {
    packageManifest()
    expect(getModuleLocators({ id: 'marketing_consents', from: '@pkarw/marketing_consents', locator: 'github:pkarw/consents' }, resolver)).toEqual(['github:pkarw/consents'])
  })

  it.each(['1.2.3', '^1.0.0'])('uses the canonical manifest identity through an npm alias binding at %s', (version) => {
    packageManifest(undefined, '@other/consents')
    dependency(`npm:@other/consents@${version}`, '@app/consents_alias')
    const locators = getModuleLocators({ id: 'marketing_consents', from: '@app/consents_alias', packageName: '@other/consents' }, resolver)
    expect(locators).toEqual(['npm:@other/consents'])
    expect(resolveModuleRequirement('npm:@app/consents_alias', [{ id: 'marketing_consents', locators }])).toBeUndefined()
  })

  it('observes a GitHub source through a binding whose name differs from the manifest', () => {
    packageManifest(undefined, '@other/consents')
    dependency('github:pkarw/consents#commit', '@app/consents_alias')
    expect(getModuleLocators({ id: 'marketing_consents', from: '@app/consents_alias' }, resolver)).toEqual(['github:pkarw/consents'])
  })

  it('rejects an installed artifact that contradicts the npm alias target', () => {
    packageManifest(undefined, '@wrong/consents')
    dependency('npm:@other/consents@1.2.3', '@app/consents_alias')
    expect(() => getModuleLocators({ id: 'marketing_consents', from: '@app/consents_alias' }, resolver)).toThrow(/dependency origin.*disagrees with installed package/)
  })

  it('rejects a mismatching canonical name without an alias declaration', () => {
    packageManifest(undefined, '@wrong/consents')
    dependency('1.2.3')
    expect(() => getModuleLocators({ id: 'marketing_consents', from: '@pkarw/marketing_consents' }, resolver)).toThrow(/does not match the dependency binding/)
  })

  it('rejects declared canonical package identity that disagrees with the artifact', () => {
    packageManifest()
    dependency('1.2.3')
    expect(() => getModuleLocators({ id: 'marketing_consents', from: '@pkarw/marketing_consents', packageName: '@other/consents' }, resolver)).toThrow(/declared package.*disagrees with installed package/)
  })

  it('reads ejected metadata without evaluating arbitrary module code', () => {
    fs.writeFileSync(path.join(root, 'module', 'index.ts'), "throw new Error('must not execute'); export const metadata = { locator: 'github:pkarw/consents' } as const")
    expect(getModuleLocators({ id: 'marketing_consents', from: '@app' }, resolver)).toEqual(['github:pkarw/consents'])
  })

  it('retains GitHub origin after ejection without assigning npm origin from package attribution', () => {
    expect(getModuleLocators({ id: 'marketing_consents', from: '@app', packageName: '@pkarw/marketing_consents', locator: 'github:pkarw/consents' }, resolver)).toEqual(['github:pkarw/consents'])
  })

  it('keeps legacy local modules with no provenance unknown', () => {
    expect(getModuleLocators({ id: 'marketing_consents', from: '@app', packageName: '@pkarw/marketing_consents' }, resolver)).toEqual([])
  })

  it('reuses the app and binding manifests across active siblings', () => {
    packageManifest()
    dependency('1.2.3')
    const reads = jest.spyOn(fs, 'readFileSync')
    try {
      expect(getEnabledModuleIdentities(resolver, [
        { id: 'consents', from: '@pkarw/marketing_consents' },
        { id: 'preferences', from: '@pkarw/marketing_consents' },
      ])).toEqual([
        { id: 'consents', locators: ['npm:@pkarw/marketing_consents'] },
        { id: 'preferences', locators: ['npm:@pkarw/marketing_consents'] },
      ])
      expect(reads.mock.calls.filter(([file]) => file === path.join(root, 'package.json'))).toHaveLength(1)
      expect(reads.mock.calls.filter(([file]) => file === path.join(root, 'package', 'package.json'))).toHaveLength(1)
    } finally {
      reads.mockRestore()
    }
  })

  it('preserves npm registration source after ejection', () => {
    expect(getModuleLocators({ id: 'marketing_consents', from: '@app', locator: 'npm:@pkarw/marketing_consents@next' }, resolver)).toEqual(['npm:@pkarw/marketing_consents'])
  })
})
