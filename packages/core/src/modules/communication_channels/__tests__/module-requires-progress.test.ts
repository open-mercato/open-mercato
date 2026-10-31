import fs from 'node:fs'
import path from 'node:path'

import metadata from '../index'

const moduleRoot = path.join(__dirname, '..')

describe('communication_channels module dependency on progress', () => {
  // The import-history worker and its queue command resolve `progressService`
  // from the DI container, which is only registered when the `progress` module
  // is enabled. Without a declared `requires` entry, an app that enables
  // `communication_channels` without `progress` gets no build-time error — the
  // worker instead fails silently on every retry (#6094). This test guards the
  // fix: the declaration must stay in sync with the DI dependency it protects.
  it('declares progress as a required module', () => {
    expect(metadata.requires).toContain('progress')
  })

  it('still resolves progressService from the DI container in the import-history worker and command', () => {
    const workerSource = fs.readFileSync(
      path.join(moduleRoot, 'workers', 'channel-import-history.ts'),
      'utf8',
    )
    const commandSource = fs.readFileSync(
      path.join(moduleRoot, 'commands', 'queue-import-history.ts'),
      'utf8',
    )
    const resolvesProgressService = /resolve(?:<[^>]*>)?\(\s*['"]progressService['"]\s*\)/
    expect(workerSource).toMatch(resolvesProgressService)
    expect(commandSource).toMatch(resolvesProgressService)
  })
})
