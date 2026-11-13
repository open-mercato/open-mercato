import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { watch } from '../../scripts/watch.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

watch(__dirname)
