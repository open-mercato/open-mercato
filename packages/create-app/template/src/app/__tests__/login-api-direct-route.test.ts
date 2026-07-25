import fs from 'node:fs'
import path from 'node:path'

describe('login API route graph', () => {
  it('serves POST /api/auth/login through a direct route instead of the generated API catch-all', () => {
    const routePath = path.join(process.cwd(), 'src/app/api/auth/login/route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    expect(source).toContain('@open-mercato/core/modules/auth/api/login')
    expect(source).toContain('@/bootstrap')
    expect(source).not.toContain('api-routes.generated')
    expect(source).not.toContain('[...slug]')
  })
})
