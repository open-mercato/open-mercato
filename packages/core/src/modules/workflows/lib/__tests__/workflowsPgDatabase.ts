import type { StartedTestContainer } from 'testcontainers'

const EXPLICIT_URL = process.env.OM_WORKFLOWS_PG_URL ?? ''

/**
 * The workflow PostgreSQL suites run when either a throwaway server is named
 * explicitly (OM_WORKFLOWS_PG_URL) or the CI real-Postgres lane is active
 * (OM_PG_INTEGRATION=1), in which case each suite starts its own disposable
 * container. They never fall back to DATABASE_URL or a development database.
 */
export const runsAgainstPostgres = Boolean(EXPLICIT_URL) || process.env.OM_PG_INTEGRATION === '1'

export type WorkflowsPgDatabase = { url: string; release: () => Promise<void> }

export async function acquireWorkflowsPgDatabase(): Promise<WorkflowsPgDatabase> {
  if (EXPLICIT_URL) return { url: EXPLICIT_URL, release: async () => undefined }
  const { GenericContainer, Wait } = await import('testcontainers')
  const container: StartedTestContainer = await new GenericContainer('postgres:16')
    .withEnvironment({ POSTGRES_DB: 'om_workflows', POSTGRES_USER: 'postgres', POSTGRES_PASSWORD: 'postgres' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start()
  return {
    url: `postgres://postgres:postgres@${container.getHost()}:${container.getMappedPort(5432)}/om_workflows`,
    release: async () => {
      await container.stop()
    },
  }
}
