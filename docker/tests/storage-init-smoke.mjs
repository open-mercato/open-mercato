import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('../../', import.meta.url)
const dockerfile = readFileSync(new URL('Dockerfile', root), 'utf8')
const runner = dockerfile.split('FROM node:24-alpine AS runner')[1]
const install = runner.match(/RUN if \[ "\$INSTALL_CHROMIUM"[\s\S]*?\n    fi/)[0]
const ownership = runner.match(/RUN adduser -D -u 1001 omuser[\s\S]*?\n\nUSER omuser/)[0]
const template = readFileSync(new URL('packages/create-app/template/Dockerfile', root), 'utf8')
assert.match(template, /USER omuser/)
assert.doesNotMatch(template, /sudo|NOPASSWD/)
assert.match(runner, /COPY docker\/scripts\/init-storage.sh \/usr\/local\/sbin\/om-init-storage/)
assert.match(runner, /USER omuser/)
const context = mkdtempSync(join(tmpdir(), 'om-storage-smoke-'))
const tag = `om-storage-smoke:${process.pid}`
const container = `om-storage-smoke-${process.pid}`
const volume = `om-storage-smoke-${process.pid}`

function docker(args, options = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 180_000, ...options })
  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`)
  return result.stdout
}

try {
  for (const name of ['init-storage.sh', 'railway-entrypoint.sh', 'init-or-migrate.sh']) {
    copyFileSync(new URL(`docker/scripts/${name}`, root), join(context, name))
  }
  writeFileSync(join(context, 'Dockerfile'), `FROM node:24-alpine
ARG INSTALL_CHROMIUM=0
${install}
RUN mkdir -p /app/apps/mercato/storage /app/docker/scripts
COPY init-storage.sh /usr/local/sbin/om-init-storage
COPY railway-entrypoint.sh init-or-migrate.sh /app/docker/scripts/
${ownership}
WORKDIR /app/apps/mercato
`)
  docker(['build', '-t', tag, context])
  assert.equal(docker(['image', 'inspect', tag, '--format', '{{.Config.User}}']).trim(), 'omuser')
  docker(['run', '--rm', '--name', container, tag, 'sh', '-ec', 'test "$(id -u)" = 1001'])
  docker(['volume', 'create', volume])
  const mount = `type=volume,source=${volume},target=/app/apps/mercato/storage`
  const script = `
set -eu
storage=/app/apps/mercato/storage
as_app() { su -s /bin/sh omuser -c "$1"; }
deny() { if as_app "$1"; then echo "Unexpected privilege: $1"; exit 1; fi; }
test "$(stat -c '%u:%g:%a' /usr/local/sbin/om-init-storage)" = 0:0:755
for directory in /app /app/apps /app/apps/mercato /usr/local/sbin; do
  as_app "test ! -w $directory"
done
echo protected > /etc/om-storage-sentinel
chmod 600 /etc/om-storage-sentinel
mkdir "$storage/existing"
echo attachment > "$storage/existing/attachment"
chown -R 1001:1001 "$storage/existing"
ln -s /etc "$storage/escape"
ln /etc/om-storage-sentinel "$storage/hardlink"
chown root:root "$storage"
printf '#!/bin/sh\\nset -eu\\ntest "$(id -u)" = 1001\\necho "$*" >> /app/apps/mercato/storage/commands\\ncase "$*" in start) echo writable > /app/apps/mercato/storage/existing/attachment ;; esac\\n' > /usr/local/bin/yarn
chmod 755 /usr/local/bin/yarn
as_app 'sh /app/docker/scripts/railway-entrypoint.sh'
test "$(stat -c %u "$storage")" = 1001
test -f "$storage/.initialized"
grep -Fx 'mercato init' "$storage/commands"
grep -Fx start "$storage/commands"
grep -Fx writable "$storage/existing/attachment"
as_app 'sh /app/docker/scripts/railway-entrypoint.sh'
grep -Fx db:migrate "$storage/commands"
grep -Fx 'mercato auth sync-role-acls' "$storage/commands"
test "$(stat -c %u /etc/om-storage-sentinel)" = 0
test "$(stat -c %u "$storage/hardlink")" = 0
deny 'sudo -n /bin/chown omuser:omuser /etc/om-storage-sentinel'
deny 'sudo -n /bin/chown -R omuser:omuser /app/apps/mercato/storage'
deny 'sudo -n /bin/sh'
deny 'sudo -n /usr/local/sbin/om-init-storage /etc'
deny 'sudo -n /usr/local/sbin/om-init-storage /app/apps/mercato/storage/../../..'
deny '/usr/local/sbin/om-init-storage /etc'
deny 'echo replaced > /usr/local/sbin/om-init-storage'
deny 'echo replaced > /etc/sudoers.d/omuser'
deny 'ln -s /etc /app/apps/mercato/replacement'
mv "$storage" "$storage.saved"
ln -s /etc "$storage"
deny 'sudo -n /usr/local/sbin/om-init-storage'
test "$(stat -c %u /etc)" = 0
rm "$storage"
deny 'sudo -n /usr/local/sbin/om-init-storage'
mv "$storage.saved" "$storage"
as_app 'sudo -n /usr/local/sbin/om-init-storage'
test "$(stat -c %u /etc/om-storage-sentinel)" = 0
echo 'PASS: non-root startup, fresh/existing storage, no arbitrary chown, no link traversal'
`
  const output = docker(['run', '--rm', '--name', container, '--user', 'root', '-i', tag, 'sh'], { input: script })
  process.stdout.write(output)
  const volumeScript = script.replace('ln /etc/om-storage-sentinel "$storage/hardlink"',
    'touch "$storage/root-owned"; ln "$storage/root-owned" "$storage/hardlink"')
    .replace(/mv "\$storage" "\$storage.saved"[\s\S]*?mv "\$storage.saved" "\$storage"\n/, '')
  process.stdout.write(docker(['run', '--rm', '--name', container, '--mount', mount, '--user', 'root', '-i', tag, 'sh'], { input: volumeScript }))
  docker(['run', '--rm', '--name', container, '--mount', mount, tag, 'sh', '-ec',
    'test "$(id -u)" = 1001; sudo -n /usr/local/sbin/om-init-storage; test -f /app/apps/mercato/storage/.initialized; echo restart >> /app/apps/mercato/storage/existing/attachment'])
  process.stdout.write('PASS: existing volume remains writable after container replacement\n')
} finally {
  spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore', timeout: 15_000 })
  spawnSync('docker', ['volume', 'rm', volume], { stdio: 'ignore', timeout: 15_000 })
  spawnSync('docker', ['image', 'rm', tag], { stdio: 'ignore', timeout: 15_000 })
  rmSync(context, { recursive: true, force: true })
}
