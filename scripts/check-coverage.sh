#!/bin/bash
set -euo pipefail

# Parse coverage/lcov.info and exit non-zero if line or function coverage
# falls below the configured thresholds. Used as a CI gate until bun's
# built-in `coverageThreshold` option is enforced in the runner we pin to.
#
# Usage: scripts/check-coverage.sh [--line=N] [--function=N] [path/to/lcov.info]
# Defaults: line=0.60, function=0.60, file=coverage/lcov.info

line_threshold=0.60
fn_threshold=0.60
lcov_path="coverage/lcov.info"

for arg in "$@"; do
  case "$arg" in
    --line=*) line_threshold="${arg#--line=}" ;;
    --function=*) fn_threshold="${arg#--function=}" ;;
    -*) echo "unknown flag: $arg" >&2; exit 2 ;;
    *) lcov_path="$arg" ;;
  esac
done

if [ ! -f "$lcov_path" ]; then
  echo "coverage file not found: $lcov_path" >&2
  exit 2
fi

# LF/LH = lines found / hit, FNF/FNH = functions found / hit.
totals=$(awk -F: '
  $1 == "LF" { lf += $2 }
  $1 == "LH" { lh += $2 }
  $1 == "FNF" { fnf += $2 }
  $1 == "FNH" { fnh += $2 }
  END { printf "%d %d %d %d\n", lf, lh, fnf, fnh }
' "$lcov_path")

read -r lf lh fnf fnh <<< "$totals"

if [ "$lf" -eq 0 ] || [ "$fnf" -eq 0 ]; then
  echo "no coverage data in $lcov_path (LF=$lf FNF=$fnf)" >&2
  exit 2
fi

line_pct=$(awk -v h="$lh" -v f="$lf" 'BEGIN { printf "%.4f", h/f }')
fn_pct=$(awk -v h="$fnh" -v f="$fnf" 'BEGIN { printf "%.4f", h/f }')

printf "Coverage: lines=%s (%d/%d) functions=%s (%d/%d)\n" \
  "$line_pct" "$lh" "$lf" "$fn_pct" "$fnh" "$fnf"
printf "Thresholds: lines>=%s functions>=%s\n" \
  "$line_threshold" "$fn_threshold"

fail=0
if awk -v a="$line_pct" -v b="$line_threshold" 'BEGIN { exit !(a < b) }'; then
  echo "FAIL: line coverage $line_pct below threshold $line_threshold" >&2
  fail=1
fi
if awk -v a="$fn_pct" -v b="$fn_threshold" 'BEGIN { exit !(a < b) }'; then
  echo "FAIL: function coverage $fn_pct below threshold $fn_threshold" >&2
  fail=1
fi

exit "$fail"
