import fs from 'node:fs'

export function readRegularFixtureFile(file: string, maxBytes: number): string {
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK)
  try {
    const stat = fs.fstatSync(descriptor)
    if (!stat.isFile() || stat.size > maxBytes) throw new Error('[internal] model_fixture_invalid')
    const buffer = Buffer.alloc(stat.size + 1)
    let length = 0
    while (length < buffer.length) {
      const read = fs.readSync(descriptor, buffer, length, buffer.length - length, null)
      if (!read) break
      length += read
    }
    if (length > maxBytes) throw new Error('[internal] model_fixture_invalid')
    return buffer.subarray(0, length).toString('utf8')
  } finally {
    fs.closeSync(descriptor)
  }
}
