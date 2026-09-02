export type AiRuntimeSecurityProfile = 'standard' | 'hardened'

type EnvLookup = Record<string, string | undefined>

export function resolveAiRuntimeSecurityProfile(
  env: EnvLookup = process.env,
): AiRuntimeSecurityProfile {
  return env.OM_AI_RUNTIME_SECURITY_PROFILE?.trim().toLowerCase() === 'hardened'
    ? 'hardened'
    : 'standard'
}

export function isHardenedAiRuntimeProfile(env: EnvLookup = process.env): boolean {
  return resolveAiRuntimeSecurityProfile(env) === 'hardened'
}
