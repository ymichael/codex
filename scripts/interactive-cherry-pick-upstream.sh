#!/bin/bash

SOURCE_BRANCH=upstream/main

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
UPSTREAM_COMMIT_LOG="$SCRIPT_DIR/upstream-commits.log"

# Make sure commit log file exists
touch "$UPSTREAM_COMMIT_LOG"

# Load previously skipped or applied commit hashes (second word of each line)
PROCESSED_COMMITS=$(cut -d ' ' -f2 "$UPSTREAM_COMMIT_LOG")

if [ -z "$SOURCE_BRANCH" ]; then
  echo "Usage: $0 <source-branch>"
  exit 1
fi

if ! git rev-parse --verify "$SOURCE_BRANCH" >/dev/null 2>&1; then
  echo "❌ Branch '$SOURCE_BRANCH' not found."
  exit 1
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
COMMITS=$(git rev-list --reverse --no-merges "$SOURCE_BRANCH" ^"$CURRENT_BRANCH")

if [ -z "$COMMITS" ]; then
  echo "✅ No new commits to cherry-pick."
  exit 0
fi

for COMMIT in $COMMITS; do
  # Check if this commit was previously skipped
  SHORT_SHA=$(git rev-parse --short "$COMMIT")
  if echo "$PROCESSED_COMMITS" | grep -q "^$SHORT_SHA"; then
    echo "🔁 Already skipped or applied $SHORT_SHA."
    continue
  fi

  echo
  echo "🔸 Commit: $COMMIT"
  echo "----------------------------------------"
  git --no-pager show --oneline --no-color --stat --summary "$COMMIT"
  echo "----------------------------------------"

  # Try applying without committing
  git cherry-pick --no-commit "$COMMIT" >/dev/null 2>&1
  STATUS=$?

  if [ $STATUS -ne 0 ]; then
    CONFLICT="yes"
    CLEAN="unknown"
  else
    CONFLICT="no"
    # Check if tree is clean (no changes introduced)
    if git diff --quiet && git diff --cached --quiet; then
      CLEAN="yes"
    else
      CLEAN="no"
    fi
  fi

  # Always abort to clean up
  git cherry-pick --abort >/dev/null 2>&1
  git reset --hard HEAD >/dev/null 2>&1

  if [ "$CLEAN" = "yes" ]; then
    echo "🚫 Skipping $COMMIT — already applied or no changes to apply."
    SUMMARY=$(git log --oneline -n 1 "$COMMIT")
    echo "APPLIED $SUMMARY" >> "$UPSTREAM_COMMIT_LOG"
    continue
  fi

  echo "⚠️ Conflict expected: $CONFLICT"

  while true; do
    echo -n "➤ Pick this commit? (y = yes, s = skip, d = diff, q = quit): "
    read -r choice

    case "$choice" in
      y|Y)
        git cherry-pick "$COMMIT"
        if [ $? -ne 0 ]; then
          echo "❌ Conflict occurred. Resolve it and run 'git cherry-pick --continue' or abort with 'git cherry-pick --abort'."
          exit 1
        fi
        break
        ;;
      s|S)
        echo "⏩ Skipping commit $COMMIT"
        SUMMARY=$(git log --oneline -n 1 "$COMMIT")
        echo "SKIPPED $SUMMARY" >> "$UPSTREAM_COMMIT_LOG"
        break
        ;;
      d|D)
        echo
        git --no-pager show --color "$COMMIT"
        echo
        ;;
      q|Q)
        echo "👋 Quitting."
        exit 0
        ;;
      *)
        echo "❓ Invalid input."
        ;;
    esac
  done
done

echo "✅ Done cherry-picking from $SOURCE_BRANCH"
