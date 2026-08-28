# Local Queue Filesystem Watch Recovery

## Status

Proposed implementation specification for the local queue strategy. This
specification makes the existing behavior explicit before changing it.

## Contract

Filesystem notifications are an acceleration path, never the delivery
guarantee. A continuous worker MUST process a committed queue entry when:

1. the queue file is atomically replaced;
2. the queue directory is moved away and recreated;
3. `fs.watch` cannot be installed or later emits an error; or
4. the host exhausts its inotify watch quota (`ENOSPC`).

The worker MUST preserve at-least-once processing. A missed notification may
increase latency, but MUST NOT lose a committed entry. Idle workers MUST NOT
read the queue file more frequently than the configured idle safety interval.

## Failure model

On Linux, `fs.watch(file)` is backed by an inotify watch attached to the inode
identified when the watch is installed. The local queue writer replaces
`queue.json` during an atomic write. The replacement has a new inode, so a
watch on the old file is not a durable subscription to future queue files.
Moving the containing directory is stronger: the watched pathname disappears
and a later directory with the same pathname is a different filesystem object.

`ENOSPC` from `fs.watch` means the process has exhausted the kernel's inotify
watch quota; it does not mean the disk is full. Retrying continuously increases
log volume and CPU usage without changing the quota. Retries therefore MUST be
bounded and the normal safety poll MUST remain authoritative.

## Required design

The implementation MUST combine:

- a file watcher for low-latency wakeups while the current queue inode exists;
- identity comparison (`device`, `inode`) before reusing a watcher;
- re-arm after a file `rename` event;
- a parent-directory recovery signal for queue-directory replacement, when
  available;
- bounded watcher re-arm attempts after setup/error failure; and
- the existing idle safety poll as the final correctness mechanism.

The implementation MUST NOT add an unconditional high-frequency queue-file
read loop. Recovery probes may be enabled only while the watched directory is
absent or the watcher is unavailable, and MUST stop once the watcher is
re-established or the bounded recovery window expires.

## Verification matrix

| Case | Expected result |
|---|---|
| New enqueue with watcher | handler runs before safety interval |
| Atomic queue-file replacement | handler runs and watcher is re-armed |
| Queue directory moved/recreated | first entry is recovered by polling; second entry is delivered without waiting for the long idle interval |
| Watch setup throws | no job loss; bounded fallback polling remains active |
| Watch emits `ENOSPC` | no retry storm; no job loss; bounded retries then safety polling |
| Idle worker | no queue-file reads before the configured idle interval |
| Worker restart | previous watcher is closed exactly once |

## Acceptance criteria

The local queue strategy test file MUST pass in full. The full queue package
suite MUST pass without an open-handle timeout or unbounded watcher retry log.
The implementation change MUST report the observed event latency and fallback
latency separately; an event-driven result does not prove recovery behavior.
