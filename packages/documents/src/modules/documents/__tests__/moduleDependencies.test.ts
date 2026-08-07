import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { metadata } from '../index'

describe('documents module dependencies', () => {
  it('declares every hard platform service used by document routes', () => {
    expect(metadata.requires).toEqual(['auth', 'directory', 'attachments'])
  })

  it('does not promise ejection while the collaboration sidecar loads package-owned code', () => {
    expect(metadata.ejectable).toBe(false)
  })

  it('uses the public Attachments service boundary for document file routes', () => {
    const moduleRoot = join(__dirname, '..')
    const uploadRoute = readFileSync(join(moduleRoot, 'api', '[id]', 'attachments', 'route.ts'), 'utf8')
    const readRoute = readFileSync(
      join(moduleRoot, 'api', '[id]', 'attachments', '[attachmentId]', 'route.ts'),
      'utf8',
    )
    const routes = `${uploadRoute}\n${readRoute}`

    expect(routes).toContain('resolveAttachmentServicePort')
    expect(routes).not.toContain('@open-mercato/core/modules/attachments')
    expect(routes).not.toMatch(/@open-mercato\/core\/modules\/attachments\/(data|lib)\//)
    expect(routes).not.toContain('new StorageDriverFactory')
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
    expect(packageJson.dependencies?.['@mikro-orm/core']).toBe('^7.1.8')
    expect(buildSource).toContain("join(packageDir, 'server', 'documents-collab-server.ts')")
    expect(buildSource).toContain("outbase: '.'")
  })
})
