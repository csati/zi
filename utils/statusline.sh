#!/bin/bash
# Claude Code status line: model | dir | git branch | context % | 5h limit | weekly budget
# Receives session JSON on stdin. See https://code.claude.com/docs/en/statusline

input=$(cat)

MODEL=$(printf '%s' "$input" | jq -r '.model.display_name // "?"')
DIR=$(printf '%s' "$input" | jq -r '.workspace.current_dir // .cwd // "."')
PCT=$(printf '%s' "$input" | jq -r '.context_window.used_percentage // empty')
WEEK_USED=$(printf '%s' "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
WEEK_RESET=$(printf '%s' "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')
FIVE_USED=$(printf '%s' "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
FIVE_RESET=$(printf '%s' "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')

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

# Rate-limit pace: the rate (relative to the plan's average rate over the window)
# at which the remaining quota can be spent so it hits exactly 100% at the reset.
#   pace = remaining_quota% / (time_left / window * 100)
# window = 5 hours for the "5h" segment, 7 days for the "budget" segment.
# e.g. 85% used with 16.8h (10% of the week) left -> 15 / 10 = 150%.
# rate_limits is only present for Pro/Max after the first API response.
# Usage: rate_segment <used> <resets_at> <window_seconds> <label>
rate_segment() {
  local used=$1 reset=$2 window=$3 label=$4
  local now left used_int pace color tl
  if [ -n "$used" ] && [ "$used" != "null" ] && [ -n "$reset" ] && [ "$reset" != "null" ]; then
    now=$(date +%s)
    left=$((reset - now))
    used_int=${used%.*}
    [ -z "$used_int" ] && used_int=0
    if [ "$left" -gt 0 ]; then
      # Integer math: remaining% * window / left_seconds
      pace=$(( (100 - used_int) * window / left ))
      if [ "$pace" -ge 100 ]; then
        color=$GREEN
      elif [ "$pace" -ge 50 ]; then
        color=$YELLOW
      else
        color=$RED
      fi
      [ "$pace" -gt 999 ] && pace=">999"
      if [ "$window" -ge 86400 ]; then
        # Days with one decimal, or rounded hours if < 1 day
        if [ "$left" -ge 84600 ]; then  # >= 23.5h, so hours never round to "24h"
          tl=$(awk -v s="$left" 'BEGIN { printf "%.1fd", s / 86400 }')
        else
          tl="$(( (left + 1800) / 3600 ))h"
        fi
      else
        # Hours and zero-padded minutes, or minutes if < 1h (floored)
        if [ "$left" -ge 3600 ]; then
          tl=$(printf '%dh%02dm' $((left / 3600)) $(((left % 3600) / 60)))
        else
          tl="$((left / 60))m"
        fi
      fi
      OUT="${OUT} ${DIM}|${RESET} ${color}${pace}% ${tl}${RESET}${DIM} ${label}${RESET}"
    fi
  fi
}

rate_segment "$FIVE_USED" "$FIVE_RESET" 18000 5h
rate_segment "$WEEK_USED" "$WEEK_RESET" 604800 budget

printf '%s\n' "$OUT"
