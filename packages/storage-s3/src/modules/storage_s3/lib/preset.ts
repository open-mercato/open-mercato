import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'

const S3_INTEGRATION_ID = 'storage_s3'

type S3CredentialShape = {
  authMode?: 'access_keys'
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  region: string
  bucket: string
  endpoint?: string
  forcePathStyle?: boolean
}

type S3EnvPreset = {
  credentials: S3CredentialShape
  force: boolean
}

export type ApplyS3PresetResult =
  | { status: 'skipped'; reason: string }
  | { status: 'configured' }

function readEnvValue(env: NodeJS.ProcessEnv, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim()
    if (value) return value
  }
  return undefined
}

function readBooleanEnv(env: NodeJS.ProcessEnv, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const parsed = parseBooleanToken(env[key])
    if (parsed !== null) return parsed
  }
  return undefined
}

export function readS3EnvPreset(env: NodeJS.ProcessEnv = process.env): S3EnvPreset | null {
  const credentialKeys = {
    accessKeyId: ['OM_INTEGRATION_STORAGE_S3_ACCESS_KEY_ID'],
    secretAccessKey: ['OM_INTEGRATION_STORAGE_S3_SECRET_ACCESS_KEY'],
    sessionToken: ['OM_INTEGRATION_STORAGE_S3_SESSION_TOKEN'],
    region: ['OM_INTEGRATION_STORAGE_S3_REGION'],
    bucket: ['OM_INTEGRATION_STORAGE_S3_BUCKET'],
  } as const

  const anyCredentialProvided = Object.values(credentialKeys).some((keys) =>
    Boolean(readEnvValue(env, [...keys])),
  )
  if (!anyCredentialProvided) return null

  const accessKeyId = readEnvValue(env, [...credentialKeys.accessKeyId])
  const secretAccessKey = readEnvValue(env, [...credentialKeys.secretAccessKey])
  const sessionToken = readEnvValue(env, [...credentialKeys.sessionToken])
  const region = readEnvValue(env, [...credentialKeys.region])
  const bucket = readEnvValue(env, [...credentialKeys.bucket])

  if (!accessKeyId || !secretAccessKey || !region || !bucket) {
    throw new Error(
      '[storage_s3] Incomplete S3 env preset. Set OM_INTEGRATION_STORAGE_S3_ACCESS_KEY_ID, ' +
        'OM_INTEGRATION_STORAGE_S3_SECRET_ACCESS_KEY, OM_INTEGRATION_STORAGE_S3_REGION, ' +
        'and OM_INTEGRATION_STORAGE_S3_BUCKET.',
    )
  }

  const endpoint = readEnvValue(env, ['OM_INTEGRATION_STORAGE_S3_ENDPOINT'])
  const forcePathStyle = readBooleanEnv(env, ['OM_INTEGRATION_STORAGE_S3_FORCE_PATH_STYLE'])

  return {
    credentials: {
      authMode: 'access_keys',
      accessKeyId,
      secretAccessKey,
      ...(sessionToken ? { sessionToken } : {}),
      region,
      bucket,
      ...(endpoint ? { endpoint } : {}),
      ...(forcePathStyle !== undefined ? { forcePathStyle } : {}),
    },
    force:
      readBooleanEnv(env, ['OM_INTEGRATION_STORAGE_S3_FORCE_PRECONFIGURE']) ?? false,
  }
}

export async function applyS3EnvPreset(params: {
  credentialsService: CredentialsService
  integrationLogService?: IntegrationLogService
  scope: IntegrationScope
  force?: boolean
  env?: NodeJS.ProcessEnv
}): Promise<ApplyS3PresetResult> {
  const preset = readS3EnvPreset(params.env)
  if (!preset) {
    return { status: 'skipped', reason: 'No S3 preset env variables were provided.' }
  }

  const force = params.force ?? preset.force
  if (!force) {
    const existing = await params.credentialsService.getRaw(S3_INTEGRATION_ID, params.scope)
    if (existing) {
      return {
        status: 'skipped',
        reason: 'S3 credentials already exist. Use OM_INTEGRATION_STORAGE_S3_FORCE_PRECONFIGURE=true to overwrite.',
      }
    }
  }

  await params.credentialsService.save(S3_INTEGRATION_ID, preset.credentials, params.scope)

  if (params.integrationLogService) {
    await params.integrationLogService
      .scoped(S3_INTEGRATION_ID, params.scope)
      .info('S3 integration was preconfigured from environment variables.', {
        region: preset.credentials.region,
        bucket: preset.credentials.bucket,
        endpoint: preset.credentials.endpoint ?? null,
      })
  }

  return { status: 'configured' }
}
