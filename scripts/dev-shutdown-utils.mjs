import spawn from 'cross-spawn'

// Windows does not propagate signals from a parent process down to grandchildren
// the way POSIX does: child.kill('SIGTERM'/'SIGKILL') only terminates the direct
// child, leaving any further descendants (next dev, mercato generate watch, etc.)
// alive and still holding ports. taskkill with /T (tree) /F (force) is the
// platform-blessed way to terminate the whole descendant tree. On POSIX we keep
// child.kill so the existing graceful-then-forced two-phase shutdown is preserved.
export function killProcessTree(child, signal, options = {}) {
  if (!child) return false

  const platform = options.platform ?? process.platform
  const spawnImpl = options.spawn ?? spawn

  if (platform === 'win32') {
    const pid = child.pid
    if (typeof pid !== 'number' || Number.isNaN(pid) || pid <= 0) {
      return false
    }
    try {
      const killer = spawnImpl('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      if (killer && typeof killer.on === 'function') {
        killer.on('error', () => { /* best-effort: taskkill may not exist on stripped images */ })
      }
      return true
    } catch {
      return false
    }
  }

  if (child.killed) return false
  try {
    child.kill(signal)
    return true
  } catch {
    return false
  }
}
