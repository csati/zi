#!/bin/bash
# Claude Code status line: model | dir | git branch | context % | weekly budget
# Receives session JSON on stdin. See https://code.claude.com/docs/en/statusline

input=$(cat)

MODEL=$(printf '%s' "$input" | jq -r '.model.display_name // "?"')
DIR=$(printf '%s' "$input" | jq -r '.workspace.current_dir // .cwd // "."')
PCT=$(printf '%s' "$input" | jq -r '.context_window.used_percentage // empty')
WEEK_USED=$(printf '%s' "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
WEEK_RESET=$(printf '%s' "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')

# Git branch (worktree-aware), falls back to the repo's own lookup.
BRANCH=$(printf '%s' "$input" | jq -r '.worktree.branch // empty')
if [ -z "$BRANCH" ]; then
  BRANCH=$(git -C "$DIR" branch --show-current 2>/dev/null)
  # Detached HEAD → short sha
  [ -z "$BRANCH" ] && BRANCH=$(git -C "$DIR" rev-parse --short HEAD 2>/dev/null)
fi

# Dirty marker
DIRTY=""
if [ -n "$BRANCH" ] && [ -n "$(git -C "$DIR" status --porcelain 2>/dev/null)" ]; then
  DIRTY="*"
fi

DIM=$'\033[2m'
CYAN=$'\033[36m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
RED=$'\033[31m'
RESET=$'\033[0m'

OUT="${DIM}[${MODEL}]${RESET} ${CYAN}${DIR##*/}${RESET}"

if [ -n "$BRANCH" ]; then
  OUT="${OUT} ${DIM}|${RESET} ${GREEN}⎇ ${BRANCH}${DIRTY}${RESET}"
fi

if [ -n "$PCT" ] && [ "$PCT" != "null" ]; then
  PCT_INT=${PCT%.*}
  [ -z "$PCT_INT" ] && PCT_INT=0
  if [ "$PCT_INT" -ge 80 ]; then
    COLOR=$RED
  elif [ "$PCT_INT" -ge 60 ]; then
    COLOR=$YELLOW
  else
    COLOR=$GREEN
  fi
  # 10-cell bar
  FILLED=$((PCT_INT / 10))
  [ "$FILLED" -gt 10 ] && FILLED=10
  BAR=""
  for i in $(seq 1 10); do
    if [ "$i" -le "$FILLED" ]; then BAR="${BAR}▓"; else BAR="${BAR}░"; fi
  done
  OUT="${OUT} ${DIM}|${RESET} ${COLOR}${BAR} ${PCT_INT}%${RESET}${DIM} ctx${RESET}"
fi

# Weekly budget: the rate (relative to the plan's average weekly rate) at which
# the remaining quota can be spent so it hits exactly 100% at the reset.
#   pace = remaining_quota% / (time_left / 7 days * 100)
# e.g. 85% used with 16.8h (10% of the week) left -> 15 / 10 = 150%.
# rate_limits is only present for Pro/Max after the first API response.
if [ -n "$WEEK_USED" ] && [ "$WEEK_USED" != "null" ] && [ -n "$WEEK_RESET" ] && [ "$WEEK_RESET" != "null" ]; then
  NOW=$(date +%s)
  LEFT=$((WEEK_RESET - NOW))
  WEEK_USED_INT=${WEEK_USED%.*}
  [ -z "$WEEK_USED_INT" ] && WEEK_USED_INT=0
  if [ "$LEFT" -gt 0 ]; then
    # Integer math: remaining% * 604800 / left_seconds
    PACE=$(( (100 - WEEK_USED_INT) * 604800 / LEFT ))
    if [ "$PACE" -ge 100 ]; then
      COLOR=$GREEN
    elif [ "$PACE" -ge 50 ]; then
      COLOR=$YELLOW
    else
      COLOR=$RED
    fi
    [ "$PACE" -gt 999 ] && PACE=">999"
    # Time left until the reset: days with one decimal, or rounded hours if < 1 day
    if [ "$LEFT" -ge 84600 ]; then  # >= 23.5h, so hours never round to "24h"
      TL=$(awk -v s="$LEFT" 'BEGIN { printf "%.1fd", s / 86400 }')
    else
      TL="$(( (LEFT + 1800) / 3600 ))h"
    fi
    OUT="${OUT} ${DIM}|${RESET} ${COLOR}${PACE}% ${TL}${RESET}${DIM} budget${RESET}"
  fi
fi

printf '%s\n' "$OUT"
