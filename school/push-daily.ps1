# Pushes daily lessons into the dashboard.
#
#   powershell -ExecutionPolicy Bypass -File push-daily.ps1 -Path daily.json
#
# Merges by id so re-running never duplicates. -Replace wipes the queue first.

param(
  [Parameter(Mandatory=$true)][string]$Path,
  [switch]$Replace
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$U = 'https://llrmrekixkrtxuyqsbwb.supabase.co'
$K = 'sb_publishable_jD7t0YZl64xkLAPYJOfOgQ_GBnROkJv'
$H = @{ apikey = $K; Authorization = "Bearer $K" }

if (-not (Test-Path $Path)) { throw "No file at $Path" }
$incoming = Get-Content $Path -Raw -Encoding UTF8 | ConvertFrom-Json
if ($incoming -isnot [array]) { $incoming = @($incoming) }

$problems = @()
foreach ($l in $incoming) {
  if (-not $l.id)    { $problems += "a lesson is missing 'id'" }
  if (-not $l.title) { $problems += "lesson '$($l.id)' is missing 'title'" }
  if (-not $l.teach -or $l.teach.Count -lt 1) { $problems += "lesson '$($l.id)' has no teach points" }
  # Four minutes is the promise the UI makes. More than three points breaks it.
  if ($l.teach.Count -gt 3) { $problems += "lesson '$($l.id)' has $($l.teach.Count) teach points; max is 3" }
  foreach ($t in $l.teach) {
    if (-not $t.point -or -not $t.plain) { $problems += "lesson '$($l.id)' has a teach entry missing point/plain" }
  }
}
if ($problems.Count) {
  Write-Host "Not loadable:" -ForegroundColor Red
  $problems | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  throw "$($problems.Count) problem(s)."
}

$byCourse = $incoming | Group-Object courseId
foreach ($g in $byCourse) { Write-Host ("{0}: {1} lesson(s)" -f $g.Name, $g.Count) -ForegroundColor Cyan }

$row = Invoke-RestMethod -Uri "$U/rest/v1/matrix?id=eq.school&select=data" -Headers $H -Method Get
if (-not $row) { throw "No 'school' row yet. Open the dashboard once so it seeds itself." }
$data = $row[0].data

$existing = @()
if ($data.PSObject.Properties.Name -contains 'daily' -and $data.daily) { $existing = @($data.daily) }

if ($Replace) {
  $merged = $incoming
  Write-Host "Replacing the daily queue." -ForegroundColor Yellow
} else {
  $ids = @($incoming | ForEach-Object { $_.id })
  $merged = @($existing | Where-Object { $ids -notcontains $_.id }) + $incoming
}

$stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$data | Add-Member -NotePropertyName daily -NotePropertyValue $merged -Force
if ($data.PSObject.Properties.Name -notcontains 'dailyLog') {
  $data | Add-Member -NotePropertyName dailyLog -NotePropertyValue (New-Object PSObject) -Force
}
$data.updatedAt = $stamp

$body = @{ id = 'school'; data = $data; updated_at = $stamp } | ConvertTo-Json -Depth 40 -Compress
Write-Host "Payload $([math]::Round($body.Length/1KB,1)) KB"
$bytes = [Text.Encoding]::UTF8.GetBytes($body)
$null = Invoke-RestMethod -Uri "$U/rest/v1/matrix" -Method Post -Body $bytes `
  -ContentType 'application/json; charset=utf-8' `
  -Headers ($H + @{ Prefer = 'resolution=merge-duplicates' })

Write-Host "Pushed. $($merged.Count) daily lesson(s) queued." -ForegroundColor Green
