import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const repoRoot = join(__dirname, '..', '..', '..', '..')

const TARGET_FILES = [
  'packages/core/src/modules/auth/frontend/login.tsx',
  'packages/onboarding/src/modules/onboarding/frontend/onboarding/OnboardingPageClient.tsx',
]

const HARDCODED_STATUS_CLASS = /\b(?:border|bg|text)-(?:red|emerald)-\d{2,3}\b/g

describe('auth and onboarding feedback states use DS status tokens (#3165)', () => {
  it('does not use hardcoded red or emerald Tailwind classes in feedback surfaces', () => {
    const violations: string[] = []

    for (const file of TARGET_FILES) {
      const fullPath = join(repoRoot, file)
      const rel = relative(repoRoot, fullPath).split(sep).join('/')
      const lines = readFileSync(fullPath, 'utf8').split('\n')

      for (const [index, line] of lines.entries()) {
        const matches = line.match(HARDCODED_STATUS_CLASS)
        if (matches) {
          violations.push(`${rel}:${index + 1} ${matches.join(', ')}`)
        }
      }
    }

    expect(violations).toEqual([])
  })
})
