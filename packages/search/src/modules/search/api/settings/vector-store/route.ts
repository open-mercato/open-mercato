import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { VectorDriverId } from '@open-mercato/shared/modules/vector'
import type { VectorDriver } from '../../../../../vector'
import { vectorStoreSettingsOpenApi } from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['search.view'] },
}

type DriverStatus = {
  id: VectorDriverId
  name: string
  configured: boolean
  implemented: boolean
  /** Runtime reachability of the store itself; `null` when the driver exposes no probe. */
  available: boolean | null
  unavailableReason: string | null
  envVars: {
    name: string
    set: boolean
    hint: string
  }[]
}

type VectorStoreConfigResponse = {
  currentDriver: VectorDriverId
  configured: boolean
  drivers: DriverStatus[]
}

async function probeDriverStatus(
  driverId: VectorDriverId,
): Promise<{ available: boolean | null; unavailableReason: string | null }> {
  try {
    const container = await createRequestContainer()
    const drivers = container.resolve<VectorDriver[]>('vectorDrivers')
    const driver = drivers.find((entry) => entry.id === driverId)
    if (!driver?.getStatus) return { available: null, unavailableReason: null }
    const status = await driver.getStatus()
    return {
      available: status.available,
      unavailableReason: status.available ? null : status.reason ?? null,
    }
  } catch {
    return { available: null, unavailableReason: null }
  }
}

const unauthorized = async () => {
  const { t } = await resolveTranslations()
  return NextResponse.json({ error: t('api.errors.unauthorized', 'Unauthorized') }, { status: 401 })
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) return await unauthorized()

  // Check pgvector - uses existing DATABASE_URL
  const databaseUrlSet = Boolean(process.env.DATABASE_URL?.trim())

  // Check qdrant - would need QDRANT_URL
  const qdrantUrlSet = Boolean(process.env.QDRANT_URL?.trim())
  const qdrantApiKeySet = Boolean(process.env.QDRANT_API_KEY?.trim())

  // Check chromadb - would need CHROMA_URL
  const chromaUrlSet = Boolean(process.env.CHROMA_URL?.trim())

  const pgvectorStatus = databaseUrlSet
    ? await probeDriverStatus('pgvector')
    : { available: null, unavailableReason: null }

  const drivers: DriverStatus[] = [
    {
      id: 'pgvector',
      name: 'PostgreSQL (pgvector)',
      configured: databaseUrlSet,
      implemented: true,
      available: pgvectorStatus.available,
      unavailableReason: pgvectorStatus.unavailableReason,
      envVars: [
        {
          name: 'DATABASE_URL',
          set: databaseUrlSet,
          hint: 'PostgreSQL connection string with pgvector extension',
        },
      ],
    },
    {
      id: 'qdrant',
      name: 'Qdrant',
      configured: qdrantUrlSet,
      implemented: false,
      available: null,
      unavailableReason: null,
      envVars: [
        {
          name: 'QDRANT_URL',
          set: qdrantUrlSet,
          hint: 'URL of your Qdrant server (e.g., http://localhost:6333)',
        },
        {
          name: 'QDRANT_API_KEY',
          set: qdrantApiKeySet,
          hint: 'API key for Qdrant authentication (optional for local)',
        },
      ],
    },
    {
      id: 'chromadb',
      name: 'ChromaDB',
      configured: chromaUrlSet,
      implemented: false,
      available: null,
      unavailableReason: null,
      envVars: [
        {
          name: 'CHROMA_URL',
          set: chromaUrlSet,
          hint: 'URL of your ChromaDB server (e.g., http://localhost:8000)',
        },
      ],
    },
  ]

  // Currently only pgvector is supported
  const currentDriver: VectorDriverId = 'pgvector'
  const configured = databaseUrlSet

  const response: VectorStoreConfigResponse = {
    currentDriver,
    configured,
    drivers,
  }

  return NextResponse.json(response)
}

export const openApi = vectorStoreSettingsOpenApi
