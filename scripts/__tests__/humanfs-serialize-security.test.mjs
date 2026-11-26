import assert from 'node:assert/strict'
import { NodeHfs } from '@humanfs/node'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, writeFile, symlink, lstat, readlink, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const requireTerser = createRequire(require.resolve('terser-webpack-plugin/package.json'))
const serialize = requireTerser('serialize-javascript')

for (const operation of ['copy', 'copyAll']) {
  test(`HumanFS ${operation} preserves symlinks instead of disclosing target contents`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'humanfs-security-'))
    try {
      const source = path.join(directory, 'source')
      const destination = path.join(directory, 'destination')
      const secret = path.join(directory, 'outside.txt')
      await mkdir(source)
      await writeFile(secret, 'synthetic private fixture')
      await symlink(secret, path.join(source, 'link.txt'))
      const filesystem = new NodeHfs()
      if (operation === 'copy') {
        await filesystem.copy(path.join(source, 'link.txt'), destination)
        assert.equal((await lstat(destination)).isSymbolicLink(), true)
        assert.equal(await readlink(destination), secret)
      } else {
        await filesystem.copyAll(source, destination)
        assert.equal((await lstat(path.join(destination, 'link.txt'))).isSymbolicLink(), true)
        assert.equal(await readlink(path.join(destination, 'link.txt')), secret)
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}

test('HumanFS still copies ordinary files', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'humanfs-control-'))
  try {
    const source = path.join(directory, 'source.txt')
    const destination = path.join(directory, 'destination.txt')
    await writeFile(source, 'ordinary content')
    await new NodeHfs().copy(source, destination)
    assert.equal(await readFile(destination, 'utf8'), 'ordinary content')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('serialization escapes a function ending with a bare script closing tag', () => {
  function first() {}
  function second() {}
  first.toString = () => 'function first(){ return 1 }//</script'
  second.toString = () => 'function second(value){ return value } > <img src=x onerror=alert(1)>'
  const serialized = serialize({ nested: { first }, second }, { space: 2 })
  assert.doesNotMatch(serialized, /<\/script[\t\n\f\r />]/i)
})

test('serialization preserves ordinary values and callable functions', () => {
  const serialized = serialize({ label: '</script>', double: function (value) { return value * 2 } })
  const restored = Function(`return (${serialized})`)()
  assert.equal(restored.label, '</script>')
  assert.equal(restored.double(3), 6)
})
