import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { metadata } from '../index'

describe('documents module dependencies', () => {
  it('requires the attachment schema used by document migrations and runtime routes', () => {
    expect(metadata.requires).toEqual(['attachments'])
  })

  it('publishes a compiled collaboration sidecar contract for production workloads', () => {
    const packageRoot = join(__dirname, '..', '..', '..', '..')
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
      exports?: Record<string, unknown>
      dependencies?: Record<string, string>
    }
    const buildSource = readFileSync(join(packageRoot, 'build.mjs'), 'utf8')

    expect(packageJson.scripts?.['collab:prod']).toBe('node dist/server/documents-collab-server.js')
    expect(packageJson.exports?.['./collab-server']).toEqual(expect.objectContaining({
      default: './dist/server/documents-collab-server.js',
    }))
    expect(packageJson.dependencies?.['@open-mercato/events']).toBe('workspace:*')
    expect(packageJson.dependencies?.['@mikro-orm/core']).toBe('^7.1.3')
    expect(buildSource).toContain("join(packageDir, 'server', 'documents-collab-server.ts')")
    expect(buildSource).toContain("outbase: '.'")
  })
})
