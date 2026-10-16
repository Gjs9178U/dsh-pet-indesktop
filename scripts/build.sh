#!/usr/bin/env bash
#
# build.sh — the historical entry point, kept because people type it.
#
# The real build is Node (scripts/build.mjs): the maintainer's machine is
# Windows, where `bash` is not guaranteed to exist, so bash must never be the
# only way to build. This script only forwards.
#
# Use it, or `node scripts/build.mjs` directly — they do the same thing.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "${here}/build.mjs" "$@"
