import { readFileSync } from 'node:fs'
import path from 'node:path'

const coreRoot = path.resolve(__dirname, '../../../../..')
const enterpriseRoot = path.resolve(coreRoot, '../enterprise')

const writerCoverage = [
  ['src/modules/auth/commands/users.ts', 'lockUserRoleWriterAuthorizationState'],
  ['src/modules/auth/commands/roles.ts', 'lockRoleWriterAuthorizationState'],
  ['src/modules/auth/commands/acl.ts', 'lockRoleWriterAuthorizationState'],
  ['src/modules/auth/commands/acl.ts', 'lockUserAclWriterAuthorizationState'],
  ['src/modules/auth/cli.ts', 'lockUserRoleWriterAuthorizationState'],
  ['src/modules/auth/lib/setup-app.ts', 'lockUserRoleWriterAuthorizationState'],
  ['src/modules/auth/lib/setup-app.ts', 'lockRoleAclWriterAuthorizationState'],
  ['src/modules/auth/lib/executionPrincipal.ts', 'lockAuthorizationState'],
  ['src/modules/api_keys/api/keys/route.ts', "commandId: 'api_keys.keys.create'"],
  ['src/modules/api_keys/services/apiKeyService.ts', 'lockRoleWriterAuthorizationState'],
] as const

const enterpriseWriterCoverage = [
  ['src/modules/sso/services/accountLinkingService.ts', 'lockUserRoleWriterAuthorizationState'],
  ['src/modules/agent_orchestrator/lib/identity/agentPrincipalService.ts', 'lockAuthorizationState'],
] as const

describe('authorization-state writer protocol coverage', () => {
  it.each(writerCoverage)('%s uses %s', (relativePath, helper) => {
    const source = readFileSync(path.resolve(coreRoot, relativePath), 'utf8')
    expect(source).toContain(helper)
  })

  it.each(enterpriseWriterCoverage)('%s uses %s', (relativePath, helper) => {
    const source = readFileSync(path.resolve(enterpriseRoot, relativePath), 'utf8')
    expect(source).toContain(helper)
  })

  it('keeps both service-level rolesJson insertions behind role-parent locks', () => {
    const source = readFileSync(
      path.resolve(coreRoot, 'src/modules/api_keys/services/apiKeyService.ts'),
      'utf8',
    )
    const createApiKey = source.slice(
      source.indexOf('export async function createApiKey('),
      source.indexOf('export async function deleteApiKey('),
    )
    const createSessionApiKey = source.slice(
      source.indexOf('export async function createSessionApiKey('),
      source.indexOf('export async function findApiKeyBySessionToken('),
    )
    expect(createApiKey).toContain('lockRoleWriterAuthorizationState')
    expect(createSessionApiKey).toContain('lockRoleWriterAuthorizationState')
  })
})
