import { constants } from 'node:fs'
import { chmod, mkdir, open, rename, lstat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

export interface RotationArtifactCipher {
  seal(plaintext: Uint8Array): Promise<Uint8Array>
  open(ciphertext: Uint8Array): Promise<Uint8Array>
}

export class RotationArtifactStore {
  private readonly directory: string
  constructor(directory: string, private readonly cipher: RotationArtifactCipher) {
    this.directory = resolve(directory)
  }

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: false, mode: 0o700 })
    await chmod(this.directory, 0o700)
  }

  private path(name: string): string {
    if (!/^(header|run-key|checkpoint|chunk-[0-9]{12})$/.test(name)) throw new Error('[internal] ROTATION_ARTIFACT_INVALID')
    return join(this.directory, `${name}.age`)
  }

  async write(name: string, plaintext: Uint8Array): Promise<void> {
    if (plaintext.byteLength > 8 * 1024 * 1024) throw new Error('[internal] ROTATION_ARTIFACT_LIMIT')
    const path = this.path(name)
    const temporary = `${path}.${randomUUID()}.partial`
    const ciphertext = await this.cipher.seal(plaintext)
    const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try { await file.writeFile(ciphertext); await file.sync() } finally { await file.close() }
    await rename(temporary, path)
    const directory = await open(this.directory, constants.O_RDONLY)
    try { await directory.sync() } finally { await directory.close() }
  }

  async read(name: string): Promise<Buffer> {
    const path = this.path(name)
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 9 * 1024 * 1024) throw new Error('[internal] ROTATION_ARTIFACT_INVALID')
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const plaintext = Buffer.from(await this.cipher.open(await file.readFile()))
      if (plaintext.length > 8 * 1024 * 1024) throw new Error('[internal] ROTATION_ARTIFACT_LIMIT')
      return plaintext
    } finally { await file.close() }
  }
}
