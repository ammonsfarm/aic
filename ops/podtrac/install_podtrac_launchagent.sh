#!/usr/bin/env bash
set -euo pipefail

ROOT="${AIC_PODCAST_ROOT:-/Users/van/firebase/aic_podcast}"
PLIST="$HOME/Library/LaunchAgents/com.ammonsfarm.aic-podtrac-ingest.plist"
PYTHON="$ROOT/.venv-pg/bin/python"
APPLESCRIPT="$ROOT/scripts/run_podtrac_ingest_terminal.applescript"

mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/run_logs"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.ammonsfarm.aic-podtrac-ingest</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/osascript</string>
    <string>$APPLESCRIPT</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$ROOT</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>7</integer>
    <key>Minute</key>
    <integer>30</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>$ROOT/run_logs/launchd_podtrac_ingest.out.log</string>
  <key>StandardErrorPath</key>
  <string>$ROOT/run_logs/launchd_podtrac_ingest.err.log</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/com.ammonsfarm.aic-podtrac-ingest"

echo "Installed $PLIST"
launchctl print "gui/$(id -u)/com.ammonsfarm.aic-podtrac-ingest" | sed -n '1,80p'
