#!/usr/bin/env node
// Snapshot resident-set-size (VmRSS) for a process and its descendants on Linux.
//
// Usage:
//   node scripts/profile-dev-rss.mjs <pid> [--label <name>] [--json]
//
// Reads `/proc/<pid>/status` for the given PID and every descendant
// (recursively walking `/proc/*/status` Tgid → PPid) and prints a
// table plus a total. Designed for measuring the `yarn dev` process
// tree before/after the consolidated package watcher switch.
//
// Linux-only — `/proc` is required. Bail out cleanly on macOS/Windows.

import { readFileSync, readdirSync, statSync } from 'node:fs'

function parseArgs(argv) {
  const args = { pid: null, label: null, json: false }
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json') args.json = true
    else if (arg === '--label') args.label = argv[++i]
    else if (!args.pid) args.pid = Number(arg)
  }
  return args
}

function readStatus(pid) {
  try {
    const text = readFileSync(`/proc/${pid}/status`, 'utf8')
    const name = /^Name:\s+(.*)$/m.exec(text)?.[1]?.trim() ?? '?'
    const rssKb = Number(/^VmRSS:\s+(\d+)\s+kB/m.exec(text)?.[1] ?? '0')
    const ppid = Number(/^PPid:\s+(\d+)$/m.exec(text)?.[1] ?? '0')
    return { pid, ppid, name, rssKb }
  } catch {
    return null
  }
}

function listAllPids() {
  return readdirSync('/proc')
    .filter((entry) => /^\d+$/.test(entry))
    .map((entry) => Number(entry))
}

function collectTree(rootPid) {
  const all = []
  for (const pid of listAllPids()) {
    const status = readStatus(pid)
    if (status) all.push(status)
  }
  const byPpid = new Map()
  for (const proc of all) {
    if (!byPpid.has(proc.ppid)) byPpid.set(proc.ppid, [])
    byPpid.get(proc.ppid).push(proc)
  }
  const out = []
  const queue = [rootPid]
  const seen = new Set()
  while (queue.length > 0) {
    const pid = queue.shift()
    if (seen.has(pid)) continue
    seen.add(pid)
    const self = all.find((proc) => proc.pid === pid)
    if (self) out.push(self)
    const kids = byPpid.get(pid) ?? []
    for (const kid of kids) queue.push(kid.pid)
  }
  return out
}

function fmtKb(kb) {
  if (kb < 1024) return `${kb} kB`
  if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(1)} MB`
  return `${(kb / 1024 / 1024).toFixed(2)} GB`
}

function main() {
  const args = parseArgs(process.argv)
  if (!Number.isFinite(args.pid) || args.pid <= 0) {
    console.error('usage: node scripts/profile-dev-rss.mjs <pid> [--label <name>] [--json]')
    process.exit(2)
  }

  if (process.platform !== 'linux') {
    console.error('profile-dev-rss.mjs is Linux-only (requires /proc).')
    process.exit(2)
  }

  let procExists = true
  try {
    statSync(`/proc/${args.pid}`)
  } catch {
    procExists = false
  }
  if (!procExists) {
    console.error(`pid ${args.pid} not found in /proc`)
    process.exit(2)
  }

  const tree = collectTree(args.pid)
  const totalKb = tree.reduce((acc, proc) => acc + proc.rssKb, 0)

  if (args.json) {
    console.log(JSON.stringify({
      label: args.label ?? null,
      rootPid: args.pid,
      processes: tree.length,
      totalRssKb: totalKb,
      totalRssMB: Math.round((totalKb / 1024) * 10) / 10,
      tree: tree.map((proc) => ({
        pid: proc.pid,
        ppid: proc.ppid,
        name: proc.name,
        rssKb: proc.rssKb,
      })),
    }, null, 2))
    return
  }

  const heading = args.label
    ? `RSS profile [${args.label}] for pid ${args.pid} and ${tree.length - 1} descendant(s):`
    : `RSS profile for pid ${args.pid} and ${tree.length - 1} descendant(s):`
  console.log(heading)
  console.log('-'.repeat(heading.length))
  for (const proc of tree) {
    console.log(`  ${String(proc.pid).padStart(7)}  ${String(proc.ppid).padStart(7)}  ${fmtKb(proc.rssKb).padStart(10)}  ${proc.name}`)
  }
  console.log('-'.repeat(heading.length))
  console.log(`TOTAL: ${fmtKb(totalKb)} across ${tree.length} processes`)
}

main()
