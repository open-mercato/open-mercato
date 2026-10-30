#!/usr/bin/env bash
# Runs one command inside a container shaped like a GitHub-hosted private-repo runner
# (7 GB RAM, no swap, 2 vCPU) and prints exit code, wall time, cgroup memory.peak and oom_kill.
# usage: measure-step.sh <absolute-app-dir> <label> <command...>
# Notes: memory.peak includes reclaimable page cache, so values at the 7168 MiB cap are an
# upper bound; oom_kill>0 is the real failure signal. Docker cannot hide host cores from
# os.cpus(), so Next spawns (host cores - 1) workers; patch the scratch app's next.config.ts
# with `experimental.cpus: 1` (behind an env flag) to mimic a 2-vCPU runner.
APP="$1"; LABEL="$2"; shift 2
WORK="${MEASURE_WORK_DIR:-${TMPDIR:-/tmp}/om-ci-measure}"
mkdir -p "$WORK/corepack" "$WORK/home"
cat > "$WORK/inner.sh" <<'INNER'
mkdir -p /home/runner/bin && corepack enable --install-directory /home/runner/bin >/dev/null 2>&1; export PATH=/home/runner/bin:$PATH
label="$1"; shift
start=$(date +%s); "$@"; rc=$?
oom=$(awk '$1=="oom_kill"{print $2}' /sys/fs/cgroup/memory.events)
echo "MEASURE label=$label rc=$rc seconds=$(( $(date +%s)-start )) peak_mib=$(( $(cat /sys/fs/cgroup/memory.peak) / 1048576 )) oom_kill=$oom"
exit $rc
INNER
docker run --rm --memory=7g --memory-swap=7g --cpus=2 --cpuset-cpus=0,1 \
  -u "$(id -u):$(id -g)" -e HOME=/home/runner -e COREPACK_HOME=/corepack -e CI=true \
  -v "$WORK/home:/home/runner" -v "$WORK/corepack:/corepack" -v "$WORK/inner.sh:/inner.sh:ro" -v "$APP:$APP" -w "$APP" \
  node:24.20.0-trixie bash /inner.sh "$LABEL" "$@"
