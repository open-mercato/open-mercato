declare module 'cross-spawn' {
  import type { spawn as spawnFunction, spawnSync } from 'node:child_process'

  const spawn: typeof spawnFunction & { sync: typeof spawnSync }

  export default spawn
}
