import fs from 'node:fs'
import path from 'node:path'

describe('login route graph', () => {
  it('serves /login through a direct route instead of the generated frontend catch-all', () => {
    const routePath = path.join(process.cwd(), 'src/app/login/page.tsx')
    const source = fs.readFileSync(routePath, 'utf8')

    expect(source).toContain('@open-mercato/core/modules/auth/frontend/login')
    expect(source).not.toContain('frontend-routes.generated')
    expect(source).not.toContain('@/bootstrap')
  })
})
