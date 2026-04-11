#!/bin/bash
# ds-migrate-typography.sh
# Portable: macOS + Linux (uses perl -i -pe instead of sed -i)
# Uruchamiać per-moduł, potem review diff

set -euo pipefail
MODULE_PATH="$1"  # np. packages/core/src/modules/customers

if [ -z "$MODULE_PATH" ]; then
  echo "Usage: bash ds-migrate-typography.sh <module-path>"
  exit 1
fi

echo "=== Typography migration: $MODULE_PATH ==="

# Portable in-place replace using perl (works identically on macOS and Linux)
replace() {
  find "$MODULE_PATH" -name "*.tsx" -exec perl -i -pe "$1" {} +
}

replace 's/text-\[10px\]/text-xs/g'
echo "  text-[10px] → text-xs: done"

replace 's/text-\[11px\]/text-overline/g'
echo "  text-[11px] → text-overline: done"

replace 's/text-\[12px\]/text-xs/g'
echo "  text-[12px] → text-xs: done"

replace 's/text-\[13px\]/text-sm/g'
echo "  text-[13px] → text-sm: done"

replace 's/text-\[14px\]/text-sm/g'
echo "  text-[14px] → text-sm: done"

replace 's/tracking-widest/tracking-wider/g'
echo "  tracking-widest → tracking-wider: done"

replace 's/tracking-\[0\.15em\]/tracking-wider/g'
echo "  tracking-[0.15em] → tracking-wider: done"

echo "=== MANUAL CHECK NEEDED: text-[15px] (2 instances, contextual decision) ==="
rg 'text-\[15px\]' "$MODULE_PATH" --type tsx || echo "  (none in this module)"

echo "=== Done. Review with: git diff $MODULE_PATH ==="
