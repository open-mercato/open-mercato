import { PrivacyServiceError } from './errors'

export type EnvironmentClassification = 'production' | 'staging' | 'sandbox' | 'test' | 'development'

const VALUES = new Set<EnvironmentClassification>([
  'production',
  'staging',
  'sandbox',
  'test',
  'development',
])

export function requireNonProductionEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): EnvironmentClassification {
  const value = env.OM_ENVIRONMENT_CLASSIFICATION?.trim().toLowerCase()
  if (!value || !VALUES.has(value as EnvironmentClassification)) {
    throw new PrivacyServiceError(
      'OM_ENVIRONMENT_CLASSIFICATION must explicitly identify this deployment.',
      'ENVIRONMENT_CLASSIFICATION_REQUIRED',
      409,
    )
  }
  if (value === 'production') {
    throw new PrivacyServiceError(
      'Environment sanitization is disabled on production deployments.',
      'PRODUCTION_SANITIZATION_BLOCKED',
      409,
    )
  }
  return value as EnvironmentClassification
}
