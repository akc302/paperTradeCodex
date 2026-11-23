#!/usr/bin/env bash
# Usage: commit-retry.sh "<message>" "<command>" file-or-directory...
# Re-runs the command on the newest main if another workflow pushed first, so concurrent jobs never overwrite each other.
set -uo pipefail
message=$1; command=$2; shift 2
for attempt in 1 2 3 4; do
  bash -c "$command" || exit 1
  for f in "$@"; do [ -e "$f" ] && git add "$f"; done
  if git diff --cached --quiet; then exit 0; fi
  git commit -q -m "$message"
  if git push -q; then exit 0; fi
  echo "Push rejected (attempt $attempt); replaying on the newest main."
  git fetch -q origin main && git reset -q --hard origin/main
  sleep $((attempt * 5))
done
echo 'Could not push after 4 attempts.'; exit 1
