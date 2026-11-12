import { constants } from 'node:fs'
import { chmod, mkdir, open, rename, lstat, link } from 'node:fs/promises'
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
    if (!/^(header|run-key|checkpoint|chunk-[0-9]{12}|journal-[0-9]{12}|intent-[a-f0-9]{64})$/.test(name)) throw new Error('[internal] ROTATION_ARTIFACT_INVALID')
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

  async fileIdentity(name: string): Promise<string> {
    const info = await lstat(this.path(name))
    if (!info.isFile() || info.isSymbolicLink() || info.size > 9 * 1024 * 1024 || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) throw new Error('[internal] ROTATION_ARTIFACT_INVALID')
    return `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`
  }

  async linkNames(source: string, aliases: string[]): Promise<void> {
    await this.fileIdentity(source)
    for (const name of aliases) await link(this.path(source), this.path(name))
    const directory = await open(this.directory, constants.O_RDONLY)
    try { await directory.sync() } finally { await directory.close() }
  }

  async read(name: string): Promise<Buffer> {
    const path = this.path(name)
    await this.fileIdentity(name)
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      // Validate the opened inode, then cap reads even if mutable artifact custody
      // replaces or grows a regular file concurrently.
      const info = await file.stat()
      if (!info.isFile() || info.size > 9 * 1024 * 1024 || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) throw new Error('[internal] ROTATION_ARTIFACT_INVALID')
      const ciphertext = Buffer.alloc(info.size + 1)
      let offset = 0
      while (offset < ciphertext.length) {
        const { bytesRead } = await file.read(ciphertext, offset, ciphertext.length - offset, null)
        if (!bytesRead) break
        offset += bytesRead
      }
      if (offset !== info.size) throw new Error('[internal] ROTATION_ARTIFACT_INVALID')
      const plaintext = Buffer.from(await this.cipher.open(ciphertext.subarray(0, offset)))
      if (plaintext.length > 8 * 1024 * 1024) throw new Error('[internal] ROTATION_ARTIFACT_LIMIT')
      return plaintext
    } finally { await file.close() }
  }
}
