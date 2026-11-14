import { spawnSync } from 'node:child_process'

export const WITHOUT_DOCKER_GUIDE_URL = 'https://github.com/open-mercato/open-mercato#without-docker'

type SpawnSyncLike = (command: string, args: string[], options: { stdio: 'ignore'; timeout: number; windowsHide: boolean }) => { error?: Error; status: number | null }

export function isDockerCliAvailable(spawnSyncImpl: SpawnSyncLike = spawnSync as unknown as SpawnSyncLike): boolean {
  const result = spawnSyncImpl('docker', ['--version'], { stdio: 'ignore', timeout: 5000, windowsHide: true })
  return !result.error && result.status === 0
}

export function missingDockerNotice(): string[] {
  return [
    'Docker was not found on this machine.',
    '  `yarn setup` uses Docker to start PostgreSQL, Redis and Meilisearch. Install Docker, or run PostgreSQL yourself',
    `  (Redis and Meilisearch are optional): ${WITHOUT_DOCKER_GUIDE_URL}`,
    '  With PostgreSQL running, `yarn setup` picks it up from .env.',
  ]
}
