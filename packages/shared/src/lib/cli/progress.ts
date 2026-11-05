export type ProgressBar = {
  update(completed: number): void
  complete(): void
}

export function createProgressBar(label: string, total: number): ProgressBar {
  const width = 28
  let lastPercent = -1
  let lastCompleted = -1
  let finished = false
  const startedAt = Date.now()
  const minPercentStep =
    total >= 1_000_000 ? 0.01 : total >= 100_000 ? 0.05 : total >= 10_000 ? 0.1 : 0.5
  const minCompletedStep = Math.max(1, Math.floor(total / 1000))

  const render = (completed: number) => {
    if (total <= 0 || finished) return
    const ratio = Math.min(1, Math.max(0, completed / total))
    const percentRaw = ratio * 100
    if (
      completed < total &&
      percentRaw - lastPercent < minPercentStep &&
      completed - lastCompleted < minCompletedStep
    ) {
      return
    }
    lastPercent = percentRaw
    lastCompleted = completed
    const filled = Math.round(ratio * width)
    const bar = '#'.repeat(filled).padEnd(width, '-')
    const percentLabel =
      (percentRaw >= 10 ? percentRaw.toFixed(1) : percentRaw.toFixed(2)).padStart(6, ' ')
    const countsLabel = `${completed.toLocaleString()}/${total.toLocaleString()}`
    const elapsedMs = Math.max(1, Date.now() - startedAt)
    const recordsPerSecond = completed > 0 ? (completed / elapsedMs) * 1000 : 0
    const rateLabel = `${recordsPerSecond.toFixed(1)} r/s`
    process.stdout.write(`\r${label} [${bar}] ${percentLabel}% (${countsLabel}) ${rateLabel}`)
    if (completed >= total) {
      finished = true
      process.stdout.write('\n')
    }
  }

  return {
    update: render,
    complete() {
      if (!finished && total > 0) {
        render(total)
      } else if (!finished) {
        finished = true
        process.stdout.write('\n')
      }
    },
  }
}
