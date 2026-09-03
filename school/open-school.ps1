# Launcher for the Ultramind School Command Center.
# Starts the local server only if nothing is already listening, then opens the
# dashboard. Safe to run twice - it will not stack up duplicate servers.

$port = 8777
$root = Split-Path -Parent $PSScriptRoot     # ...\Desktop\Claude
$url  = "http://localhost:$port/school/"

function Test-Port($p) {
  # TcpClient is near-instant; Test-NetConnection takes seconds on a closed port.
  $c = New-Object Net.Sockets.TcpClient
  try { $null = $c.ConnectAsync('127.0.0.1', $p).Wait(400); return $c.Connected }
  catch { return $false }
  finally { $c.Close() }
}

if (-not (Test-Port $port)) {
  $serve = Join-Path $root 'serve.ps1'
  if (-not (Test-Path $serve)) {
    Write-Host "Cannot find serve.ps1 at $serve" -ForegroundColor Red
    Write-Host "Make sure the whole Claude folder synced from OneDrive, not just school\." -ForegroundColor Yellow
    Read-Host "Press Enter to close"
    exit 1
  }
  Start-Process powershell `
    -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',$serve,'-Port',$port `
    -WindowStyle Minimized
  # Give the listener a moment to bind before pointing a browser at it.
  for ($i = 0; $i -lt 25; $i++) {
    Start-Sleep -Milliseconds 300
    if (Test-Port $port) { break }
  }
}

if (Test-Port $port) {
  Start-Process $url
} else {
  Write-Host "The server did not come up on port $port." -ForegroundColor Red
  Read-Host "Press Enter to close"
}
