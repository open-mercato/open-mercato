import { spawn } from 'node:child_process'
import { REPO_ROOT, COMPOSE_FILES, COMPOSE_PROJECT, SUT_ENV_RELATIVE } from './paths.mjs'

export function shellQuote(value) {
  const text = String(value)
  if (/^[A-Za-z0-9_\-.,/:=@%+]+$/.test(text)) return text
  return `'${text.replace(/'/g, `'\\''`)}'`
}

export function runProcess(command, args, options = {}) {
  const { input, cwd = REPO_ROOT, capture = true, allowFail = false, env, onStdout } = options
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: [input === undefined ? 'ignore' : 'pipe', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'],
    })
    const stdoutChunks = []
    const stderrChunks = []
    if (capture) {
      child.stdout.on('data', (chunk) => {
        stdoutChunks.push(chunk)
        if (onStdout) onStdout(chunk)
      })
      child.stderr.on('data', (chunk) => stderrChunks.push(chunk))
    }
    if (input !== undefined) {
      child.stdin.on('error', () => undefined)
      child.stdin.end(input)
    }
    child.on('error', reject)
    child.on('close', (code) => {
      const result = {
        code: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      }
      if (result.code !== 0 && !allowFail) {
        const error = new Error(`[perf] ${command} ${args.slice(0, 6).join(' ')} … exited with ${result.code}\n${result.stderr.slice(-2000)}`)
        error.result = result
        reject(error)
        return
      }
      resolve(result)
    })
  })
}

export function composeArgs(extra = []) {
  const files = COMPOSE_FILES.flatMap((file) => ['-f', file])
  return ['compose', '-p', COMPOSE_PROJECT, '--env-file', SUT_ENV_RELATIVE, ...files, ...extra]
}

export function createSut(target) {
  const sshHost = (target.SUT_SSH ?? '').trim()
  const remoteDir = (target.SUT_REPO_DIR ?? '').trim()
  if (sshHost && !remoteDir) throw new Error('[perf] SUT_REPO_DIR is required when SUT_SSH is set')

  function docker(args, options = {}) {
    if (!sshHost) return runProcess('docker', args, options)
    const remote = `cd ${shellQuote(remoteDir)} && docker ${args.map(shellQuote).join(' ')}`
    return runProcess('ssh', ['-o', 'BatchMode=yes', sshHost, remote], options)
  }

  function shell(script, options = {}) {
    if (!sshHost) return runProcess('sh', ['-c', script], options)
    return runProcess('ssh', ['-o', 'BatchMode=yes', sshHost, `cd ${shellQuote(remoteDir)} && ${script}`], options)
  }

  function compose(args, options = {}) {
    return docker(composeArgs(args), options)
  }

  function exec(service, command, options = {}) {
    return compose(['exec', '-T', service, ...command], options)
  }

  function psql(sql, { database, allowFail = false } = {}) {
    const db = database ?? target.POSTGRES_DB ?? 'open-mercato'
    return exec('postgres', ['sh', '-c', `psql -X -v ON_ERROR_STOP=1 -At -U "$POSTGRES_USER" -d ${shellQuote(db)} -f -`], { input: sql, allowFail })
  }

  async function psqlJson(sql, options = {}) {
    const result = await psql(`select coalesce(json_agg(row_to_json(t)), '[]'::json) from (${sql}) t;\n`, options)
    const line = result.stdout.trim().split('\n').filter(Boolean).at(-1) ?? '[]'
    return JSON.parse(line)
  }

  async function writeFile(service, path, content) {
    const dir = path.replace(/\/[^/]*$/, '') || '/'
    await exec(service, ['sh', '-c', `mkdir -p ${shellQuote(dir)} && cat > ${shellQuote(path)}`], { input: content })
  }

  async function readFile(service, path) {
    const result = await exec(service, ['cat', path])
    return result.stdout
  }

  async function writeHostFile(relativePath, content) {
    if (!sshHost) return false
    await shell(`umask 077 && cat > ${shellQuote(relativePath)}`, { input: content })
    return true
  }

  return { remote: Boolean(sshHost), docker, shell, compose, exec, psql, psqlJson, writeFile, readFile, writeHostFile }
}
