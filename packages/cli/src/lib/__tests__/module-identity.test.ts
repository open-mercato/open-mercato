import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getModuleLocators } from '../module-identity'
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

  function packageManifest(repository: unknown, name = '@pkarw/marketing_consents'): void {
    fs.writeFileSync(path.join(root, 'package', 'package.json'), JSON.stringify({ name, repository }))
  }

  it.each(['https://github.com/pkarw/consents.git', { url: 'git+https://github.com/pkarw/consents.git' }])('reads authoritative package repository %j', (repository) => {
    packageManifest(repository)
    expect(getModuleLocators({ id: 'marketing_consents', from: '@pkarw/marketing_consents' }, resolver)).toEqual(['npm:@pkarw/marketing_consents', 'github:pkarw/consents'])
  })

  it.each(['1.2.3', 'beta-tag'])('does not mistake npm version %s for GitHub provenance', (version) => {
    packageManifest('https://github.com/pkarw/consents')
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { '@pkarw/marketing_consents': version } }))
    expect(getModuleLocators({ id: 'marketing_consents', from: '@pkarw/marketing_consents' }, resolver)).toEqual(['npm:@pkarw/marketing_consents', 'github:pkarw/consents'])
  })

  it('keeps GitHub dependency origin authoritative over package repository and stale registration', () => {
    packageManifest('https://github.com/other/consents')
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { '@pkarw/marketing_consents': 'github:pkarw/consents#commit' } }))
    expect(getModuleLocators({ id: 'marketing_consents', from: '@pkarw/marketing_consents', locator: 'github:stale/consents' }, resolver)).toEqual(['npm:@pkarw/marketing_consents', 'github:pkarw/consents'])
  })

  it('uses package metadata locator when repository provenance is absent', () => {
    packageManifest(undefined)
    fs.writeFileSync(path.join(root, 'package', 'index.ts'), "export const metadata = { locator: 'github:pkarw/consents' }")
    expect(getModuleLocators({ id: 'marketing_consents', from: '@pkarw/marketing_consents' }, resolver)).toEqual(['npm:@pkarw/marketing_consents', 'github:pkarw/consents'])
  })

  it('does not let package metadata spoof npm publisher identity', () => {
    packageManifest(undefined)
    fs.writeFileSync(path.join(root, 'package', 'index.ts'), "export const metadata = { locator: 'npm:@other/marketing_consents' }")
    expect(getModuleLocators({ id: 'marketing_consents', from: '@pkarw/marketing_consents', locator: 'npm:@other/marketing_consents' }, resolver)).toEqual(['npm:@pkarw/marketing_consents'])
  })

  it('uses registered GitHub locator when package metadata has no provenance', () => {
    packageManifest(undefined)
    expect(getModuleLocators({ id: 'marketing_consents', from: '@pkarw/marketing_consents', locator: 'github:pkarw/consents' }, resolver)).toEqual(['npm:@pkarw/marketing_consents', 'github:pkarw/consents'])
  })

  it('does not assign a monorepo repository identity to every package', () => {
    packageManifest({ url: 'https://github.com/open-mercato/open-mercato', directory: 'packages/core' })
    fs.writeFileSync(path.join(root, 'package', 'index.ts'), "export const metadata = { locator: 'github:other/core' }")
    expect(getModuleLocators({ id: 'marketing_consents', from: '@pkarw/marketing_consents' }, resolver)).toEqual(['npm:@pkarw/marketing_consents'])
  })

  it('ignores mismatched package manifests without inventing a source from its repository', () => {
    packageManifest('https://github.com/other/consents', '@other/consents')
    expect(getModuleLocators({ id: 'marketing_consents', from: '@pkarw/marketing_consents' }, resolver)).toEqual(['npm:@pkarw/marketing_consents'])
  })

  it('reads ejected metadata without evaluating arbitrary module code', () => {
    fs.writeFileSync(path.join(root, 'module', 'index.ts'), "throw new Error('must not execute'); export const metadata = { locator: 'github:pkarw/consents' } as const")
    expect(getModuleLocators({ id: 'marketing_consents', from: '@app' }, resolver)).toEqual(['github:pkarw/consents'])
  })

  it('retains npm and GitHub source identity after ejection', () => {
    expect(getModuleLocators({ id: 'marketing_consents', from: '@app', packageName: '@pkarw/marketing_consents', locator: 'github:pkarw/consents' }, resolver)).toEqual(['npm:@pkarw/marketing_consents', 'github:pkarw/consents'])
  })

  it('preserves app registration source', () => {
    expect(getModuleLocators({ id: 'marketing_consents', from: '@app', locator: 'npm:@pkarw/marketing_consents@next' }, resolver)).toEqual(['npm:@pkarw/marketing_consents'])
  })
})
