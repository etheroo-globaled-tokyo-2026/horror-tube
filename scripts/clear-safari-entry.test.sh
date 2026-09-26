#!/usr/bin/env bash
set -euo pipefail

script="$(cd "$(dirname "$0")" && pwd)/clear-safari-entry.sh"

help="$( "$script" --help )"
printf '%s\n' "$help" | grep -q -- '--url'
printf '%s\n' "$help" | grep -q -- '--apply'
printf '%s\n' "$help" | grep -q -- 'enter-room'

set +e
missing="$( "$script" 2>&1 )"
status=$?
set -e
[[ "$status" -ne 0 ]]
printf '%s\n' "$missing" | grep -q -- '--url'

set +e
insecure="$( "$script" --url 'http://example.com' 2>&1 )"
status=$?
set -e
[[ "$status" -ne 0 ]]
printf '%s\n' "$insecure" | grep -q -- 'https://'

echo "clear-safari-entry tests passed"
