import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mock, test } from 'node:test'
import { pathToFileURL } from 'node:url'

const script = new URL('../../agentic/shared/scripts/execution-sandbox.mjs', import.meta.url)
const { linuxMergedUsrSymlinkArgs } = await import(pathToFileURL(script.pathname).href) as {
  linuxMergedUsrSymlinkArgs: () => string[]
}

function aliasArguments(aliases: Record<string, string>): string[] {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'om-merged-usr-test-'))
  const link = path.join(fixture, 'link')
  fs.symlinkSync('usr/lib', link)
  const stats = fs.lstatSync(link)
  const lstat = fs.lstatSync
  const readlink = fs.readlinkSync
  const statMock = mock.method(fs, 'lstatSync', (file: fs.PathLike) => Object.hasOwn(aliases, String(file)) ? stats : lstat(file))
  const linkMock = mock.method(fs, 'readlinkSync', (file: fs.PathLike) => aliases[String(file)] ?? readlink(file))
  try {
    return linuxMergedUsrSymlinkArgs()
  } finally {
    statMock.mock.restore()
    linkMock.mock.restore()
    fs.rmSync(fixture, { recursive: true, force: true })
  }
}

test('Arch merged-usr aliases preserve the ELF loader and executable paths', () => {
  assert.deepEqual(aliasArguments({ '/bin': 'usr/bin', '/sbin': 'usr/bin', '/lib': 'usr/lib', '/lib64': 'usr/lib' }), [
    '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/bin', '/sbin',
    '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib', '/lib64',
  ])
})

test('separate merged-usr sbin and lib64 targets remain supported', () => {
  assert.deepEqual(aliasArguments({ '/bin': 'usr/bin', '/sbin': 'usr/sbin', '/lib': 'usr/lib', '/lib64': 'usr/lib64' }), [
    '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/sbin', '/sbin',
    '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64',
  ])
})

test('unexpected, absolute and escaping root alias targets are not mounted', () => {
  assert.deepEqual(aliasArguments({ '/bin': 'other/bin', '/sbin': '../bin', '/lib': '/usr/lib', '/lib64': '../../private' }), [])
})
