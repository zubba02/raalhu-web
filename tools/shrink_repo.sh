#!/usr/bin/env bash
# Throw away the git history and keep only the current files, then force-push.
# The live site is unchanged; the repository just becomes small again.
# Old commits cannot be recovered afterwards.
#   bash tools/shrink_repo.sh
set -e
cd "$(dirname "$0")/.."
BRANCH=main

git checkout -q --orphan raalhu-fresh
git add -A
git commit -q -m "Raalhu site and data (history reset $(date +%Y-%m-%d))"
git branch -D "$BRANCH" >/dev/null 2>&1 || true
git branch -m "$BRANCH"
git push -f origin "$BRANCH"
git branch --set-upstream-to="origin/$BRANCH" "$BRANCH" >/dev/null 2>&1 || true
git reflog expire --expire=now --all
git gc -q --prune=now
echo "Done. Repository is now $(du -sh .git | cut -f1)."
