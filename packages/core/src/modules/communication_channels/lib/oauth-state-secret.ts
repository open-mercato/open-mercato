export function resolveOAuthStateSecretSource(env: NodeJS.ProcessEnv) {
  const dedicated = env.OM_HUB_OAUTH_STATE_KEY === undefined ? 'KMS_MASTER_KEY' : 'OM_HUB_OAUTH_STATE_KEY'
  if (env[dedicated]) return dedicated
  if (env.NODE_ENV !== 'production' && env.JWT_SECRET) return 'JWT_SECRET'
  return undefined
}
