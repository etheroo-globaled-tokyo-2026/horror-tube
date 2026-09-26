#!/usr/bin/env bash
# Reusable. Clears this Safari profile's Horror Tube waiver entry for one https origin.
# Safe to keep. Does not delete the World ID unique-human proof for enter-room.
set -euo pipefail

apply=0
url=""

usage() {
  cat <<'EOF'
Clear the Horror Tube waiver entry stored in Safari for one https origin.

Default is a dry run: it prints which of these keys are set and does not change them.
  ht.verified
  horror-tube.wallet-session
  horror-tube.payout-address

--apply removes those keys and reloads the tab. World ID still keeps the
unique-human proof for action enter-room. The same person cannot pass that
Orb scan again.

Usage:
  scripts/clear-safari-entry.sh --url https://<app-host>
  scripts/clear-safari-entry.sh --url https://<app-host> --apply

Options:
  --url     Required. https origin of the game. No default.
  --apply   Remove the keys and reload. Without this, nothing is changed.
  --help    Show this text.

Uses a Safari tab already on that origin. Opens --url when none is open.
Safari must allow JavaScript from Apple Events (Develop menu).
EOF
}

die() {
  echo "clear-safari-entry: $*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --apply)
      apply=1
      shift
      ;;
    --url)
      [[ $# -ge 2 ]] || die "Missing value for --url. Example: scripts/clear-safari-entry.sh --url https://<app-host>"
      url="$2"
      shift 2
      ;;
    *)
      die "Unknown argument: $1. Run scripts/clear-safari-entry.sh --help"
      ;;
  esac
done

[[ -n "$url" ]] || die "Missing --url. Example: scripts/clear-safari-entry.sh --url https://<app-host>"
[[ "$url" == https://* ]] || die "--url must start with https://. Got: $url"
[[ "$url" != *["\"'\\''\` "]* ]] || die "--url contains a character this script will not pass to Safari."
url="${url%/}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  die "This script drives Safari and only runs on macOS."
fi

read_js='(function () {
  var keys = ["ht.verified", "horror-tube.wallet-session", "horror-tube.payout-address"];
  var lines = [];
  for (var i = 0; i < keys.length; i++) {
    lines.push((localStorage.getItem(keys[i]) === null ? "absent " : "set ") + keys[i]);
  }
  return lines.join("\n");
})()'

apply_js='(function () {
  var keys = ["ht.verified", "horror-tube.wallet-session", "horror-tube.payout-address"];
  var removed = [];
  var absent = [];
  for (var i = 0; i < keys.length; i++) {
    if (localStorage.getItem(keys[i]) === null) absent.push(keys[i]);
    else {
      removed.push(keys[i]);
      localStorage.removeItem(keys[i]);
    }
  }
  for (var j = 0; j < keys.length; j++) {
    if (localStorage.getItem(keys[j]) !== null) return "stuck " + keys[j];
  }
  setTimeout(function () { location.reload(); }, 50);
  return "cleared removed=" + removed.join(",") + " absent=" + absent.join(",");
})()'

verify_js='(function () {
  var keys = ["ht.verified", "horror-tube.wallet-session", "horror-tube.payout-address"];
  for (var i = 0; i < keys.length; i++) {
    if (localStorage.getItem(keys[i]) !== null) return "still-set " + keys[i];
  }
  var gate = document.getElementById("demo-gate");
  var room = document.getElementById("demo-room");
  var hint = document.getElementById("hint");
  if (!gate || !room || !hint) return "missing-dom";
  if (gate.hidden) return "gate-hidden";
  if (!room.hidden) return "room-visible";
  if (hint.textContent.indexOf("WORLD ID") === -1) return "hint-not-ready";
  return "waiver";
})()'

safari_js() {
  local js="$1"
  local err
  err="$(mktemp)"
  local out
  if ! out="$(osascript - "$url" "$js" - <<'APPLESCRIPT' 2>"$err"
on run argv
  set targetUrl to item 1 of argv
  set js to item 2 of argv
  tell application "Safari"
    set foundTab to missing value
    repeat with w in windows
      repeat with t in tabs of w
        set u to URL of t as text
        if u is targetUrl or u starts with targetUrl & "/" or u starts with targetUrl & "?" or u starts with targetUrl & "#" then
          set foundTab to t
          exit repeat
        end if
      end repeat
      if foundTab is not missing value then exit repeat
    end repeat
    if foundTab is missing value then
      activate
      if (count of windows) is 0 then make new document
      tell front window
        set current tab to (make new tab with properties {URL:targetUrl & "/"})
        set foundTab to current tab
      end tell
    end if
    set tries to 0
    repeat
      set tries to tries + 1
      if tries > 40 then error "Safari tab did not finish loading " & targetUrl
      delay 0.5
      try
        set state to do JavaScript "document.readyState" in foundTab
        if state is "complete" then exit repeat
      end try
    end repeat
    return do JavaScript js in foundTab
  end tell
end run
APPLESCRIPT
)"; then
    if grep -qi -e "javascript" -e "apple event" "$err"; then
      echo "clear-safari-entry: Safari refused JavaScript from Apple Events." >&2
      echo "Turn on Develop > Allow JavaScript from Apple Events in Safari, then run the same command again." >&2
    fi
    cat "$err" >&2
    rm -f "$err"
    exit 2
  fi
  rm -f "$err"
  printf '%s\n' "$out"
}

if [[ "$apply" -eq 0 ]]; then
  echo "dry-run"
  safari_js "$read_js"
  echo "World ID still keeps the enter-room proof. Pass --apply to clear the browser keys."
  exit 0
fi

echo "apply"
safari_js "$apply_js"
echo "World ID still keeps the enter-room proof. The same person cannot pass that Orb scan again."

for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  sleep 1
  check="$(safari_js "$verify_js" || true)"
  if [[ "$check" == "waiver" ]]; then
    echo "waiver is showing"
    exit 0
  fi
  echo "waiting: $check"
done

die "Keys were removed but the waiver did not show. Last check: ${check:-none}"
