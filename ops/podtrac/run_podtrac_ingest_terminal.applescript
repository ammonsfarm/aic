set rootPath to "/Users/van/firebase/aic_podcast"
set logPath to rootPath & "/run_logs/terminal_podtrac_ingest.log"
set commandText to "cd " & quoted form of rootPath & " && " & ¬
  "if mkdir /tmp/aic_podtrac_ingest.lockdir 2>/dev/null; then " & ¬
  "trap 'rmdir /tmp/aic_podtrac_ingest.lockdir' EXIT; " & ¬
  quoted form of (rootPath & "/.venv-pg/bin/python") & " " & ¬
  quoted form of (rootPath & "/run_daily_podtrac_ingest.py") & " " & ¬
  "--env-file " & quoted form of (rootPath & "/.env") & " " & ¬
  "--log-dir " & quoted form of (rootPath & "/run_logs") & " " & ¬
  "--auth-mode chrome " & ¬
  ">> " & quoted form of logPath & " 2>&1; " & ¬
  "else echo \"$(date -Is) podtrac ingest already running\" >> " & quoted form of logPath & "; fi; exit"

tell application "Terminal"
  ignoring application responses
    do script commandText
  end ignoring
end tell
