import { readFileSync } from 'node:fs'
import path from 'node:path'

describe('team roles client boundary', () => {
  it('does not import Node.js modules into the client page', () => {
    const source = readFileSync(
      path.join(__dirname, '..', 'backend', 'staff', 'team-roles', 'page.tsx'),
      'utf8',
    )

    expect(source).not.toMatch(/from\s+['"](?:node:)?(?:fs|path|os|crypto|stream|buffer|child_process)['"]/)
  })
})
