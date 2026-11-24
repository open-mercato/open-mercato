import fs from 'node:fs'
import path from 'node:path'
import type { NextConfig } from 'next'

const appRoot = process.cwd()
const repoRoot = path.resolve(appRoot, '../..')

function commonAncestor(left: string, right: string): string {
  const leftParts = left.split(path.sep)
  const rightParts = right.split(path.sep)
  const shared: string[] = []
  for (let index = 0; index < Math.min(leftParts.length, rightParts.length); index += 1) {
    if (leftParts[index] !== rightParts[index]) break
    shared.push(leftParts[index])
  }
  return shared.join(path.sep) || path.sep
}

function resolveTurbopackRoot(): string {
  const modulesPath = path.join(repoRoot, 'node_modules')
  try {
    return commonAncestor(repoRoot, path.dirname(fs.realpathSync(modulesPath)))
  } catch {
    return repoRoot
  }
}

function relativeToApp(target: string): string {
  return `./${path.relative(appRoot, target)}`
}

const workspaceAliases: Record<string, string> = {
  '#generated/entities.ids.generated': relativeToApp(path.join(repoRoot, 'packages/ui/.storybook/fixtures/entity-ids.ts')),
  '@open-mercato/ui/*': `${relativeToApp(path.join(repoRoot, 'packages/ui/src'))}/*`,
  '@open-mercato/shared/*': `${relativeToApp(path.join(repoRoot, 'packages/shared/src'))}/*`,
  '@open-mercato/core/*': `${relativeToApp(path.join(repoRoot, 'packages/core/src'))}/*`,
}

const nextConfig: NextConfig & { agentRules?: boolean } = {
  output: 'export',
  trailingSlash: true,
  agentRules: false,
  images: { unoptimized: true },
  typescript: { ignoreBuildErrors: true },
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  turbopack: {
    root: resolveTurbopackRoot(),
    resolveAlias: workspaceAliases,
  },
}

export default nextConfig
