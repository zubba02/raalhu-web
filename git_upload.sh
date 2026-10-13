#!/usr/bin/env bash
# Commit and push the latest forecast data.
#   bash git_upload.sh [YYYYMMDD]
# Called by Initialize.py after each model run.
set -e
cd "$(dirname "$0")"

# Every day adds a few MB of data to the git history, and GitHub asks that a
# repository stays under about 1 GB.  Set this to a size in MB (for example
# 600) to have the history collapsed into a single commit automatically once
# the local .git folder grows past it.  0 = never do this automatically; run
# tools/shrink_repo.sh by hand instead.
AUTO_SHRINK_MB=0

git add -A
if git diff --cached --quiet; then
    echo "Nothing new to upload."
    exit 0
fi
git commit -q -m "Forecast ${1:-$(date +%Y%m%d)}"

size_mb=$(du -sm .git | cut -f1)
if [ "$AUTO_SHRINK_MB" -gt 0 ] && [ "$size_mb" -gt "$AUTO_SHRINK_MB" ]; then
    echo ".git is ${size_mb} MB - collapsing history"
    bash tools/shrink_repo.sh
else
    git push origin main
fi
