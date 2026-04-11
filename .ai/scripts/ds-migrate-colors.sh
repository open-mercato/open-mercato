#!/bin/bash
# ds-migrate-colors.sh
# Portable: macOS + Linux (uses perl -i -pe instead of sed -i)
# Uruchamiać per-moduł, potem review diff

set -euo pipefail
MODULE_PATH="$1"

if [ -z "$MODULE_PATH" ]; then
  echo "Usage: bash ds-migrate-colors.sh <module-path>"
  exit 1
fi

echo "=== Color migration: $MODULE_PATH ==="

# Portable in-place replace using perl
replace() {
  find "$MODULE_PATH" -name "*.tsx" -exec perl -i -pe "$1" {} +
}

# ═══ ERROR ═══
for shade in 600 700 800 900; do
  replace "s/text-red-$shade/text-status-error-text/g"
done
replace 's/text-red-500/text-status-error-icon/g'
for shade in 50 100; do
  replace "s/bg-red-$shade/bg-status-error-bg/g"
done
for shade in 200 300 500; do
  replace "s/border-red-$shade/border-status-error-border/g"
done

# ═══ SUCCESS (green) ═══
for shade in 500 600 700 800; do
  replace "s/text-green-$shade/text-status-success-text/g"
done
for shade in 50 100 200; do
  replace "s/bg-green-$shade/bg-status-success-bg/g"
done
for shade in 200 300 500; do
  replace "s/border-green-$shade/border-status-success-border/g"
done

# ═══ SUCCESS (emerald) ═══
for shade in 300 600 700 800 900; do
  replace "s/text-emerald-$shade/text-status-success-text/g"
done
for shade in 50 100; do
  replace "s/bg-emerald-$shade/bg-status-success-bg/g"
done
for shade in 200 300; do
  replace "s/border-emerald-$shade/border-status-success-border/g"
done

# ═══ WARNING (amber) ═══
for shade in 500 800 950; do
  replace "s/text-amber-$shade/text-status-warning-text/g"
done
replace "s/bg-amber-50/bg-status-warning-bg/g"
for shade in 200 500; do
  replace "s/border-amber-$shade/border-status-warning-border/g"
done

# ═══ INFO (blue) ═══
for shade in 600 700 800 900; do
  replace "s/text-blue-$shade/text-status-info-text/g"
done
replace 's/text-blue-500/text-status-info-icon/g'
for shade in 50 100; do
  replace "s/bg-blue-$shade/bg-status-info-bg/g"
done
for shade in 200 500; do
  replace "s/border-blue-$shade/border-status-info-border/g"
done

# ═══ INFO (sky — used in Alert component) ═══
replace 's/text-sky-900/text-status-info-text/g'
replace 's/border-sky-600\/30/border-status-info-border/g'
replace 's/bg-sky-500\/10/bg-status-info-bg/g'

echo "=== MANUAL REVIEW NEEDED ==="
echo "  Check: bg-red-600, bg-emerald-500, bg-emerald-600, bg-blue-600"
echo "  These are solid backgrounds — may need different token (icon/emphasis)"
rg 'bg-red-600|bg-emerald-[56]00|bg-blue-600' "$MODULE_PATH" --type tsx || echo "  (none in this module)"

echo "=== Done. Review with: git diff $MODULE_PATH ==="
