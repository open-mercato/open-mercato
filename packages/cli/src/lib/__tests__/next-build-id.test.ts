import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { resolveNextBuildIdCandidate } from '../next-build-id'

describe('resolveNextBuildIdCandidate', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-build-id-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('reads BUILD_ID directly when present', () => {
    fs.writeFileSync(path.join(tempDir, 'BUILD_ID'), 'direct-build-id\n')

    expect(resolveNextBuildIdCandidate(tempDir)).toBe('direct-build-id')
  })

  it('derives the build id from fallback-build-manifest.json', () => {
    fs.writeFileSync(
      path.join(tempDir, 'fallback-build-manifest.json'),
      JSON.stringify({
        lowPriorityFiles: [
          'static/kDq1shUVoqiq28ihLmzFg/_buildManifest.js',
          'static/kDq1shUVoqiq28ihLmzFg/_ssgManifest.js',
        ],
      }),
    )

    expect(resolveNextBuildIdCandidate(tempDir)).toBe('kDq1shUVoqiq28ihLmzFg')
  })
})
