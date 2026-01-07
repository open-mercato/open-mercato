#!/bin/bash
set -e

echo "=== Checking root ==="
yarn tsc --noEmit

for dir in packages/*/; do
  if [ -f "$dir/tsconfig.json" ]; then
    echo "=== Checking $dir ==="
    yarn tsc --noEmit -p "$dir/tsconfig.json"
  fi
done

for dir in apps/*/; do
  if [ -f "$dir/tsconfig.json" ]; then
    echo "=== Checking $dir ==="
    yarn tsc --noEmit -p "$dir/tsconfig.json"
  fi
done

echo "All type checks passed!"
