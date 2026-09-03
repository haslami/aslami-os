# Pushes a lesson set written by Claude straight into the dashboard.
#
#   powershell -ExecutionPolicy Bypass -File push-lessons.ps1 -Path lessons.json
#
# Reads the current Supabase `school` row, merges the lessons in by id (existing
# ids are left alone), and writes it back with a fresh timestamp so any open
# dashboard pulls it within a couple of seconds.

param(
  [Parameter(Mandatory=$true)][string]$Path,
  [switch]$Replace   # drop the existing queue instead of merging
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$U = 'https://llrmrekixkrtxuyqsbwb.supabase.co'
$K = 'sb_publishable_jD7t0YZl64xkLAPYJOfOgQ_GBnROkJv'
$H = @{ apikey = $K; Authorization = "Bearer $K" }

if (-not (Test-Path $Path)) { throw "No lesson file at $Path" }

$incoming = Get-Content $Path -Raw -Encoding UTF8 | ConvertFrom-Json
if ($incoming -isnot [array]) { $incoming = @($incoming) }
foreach ($l in $incoming) {
  if (-not $l.id)     { throw "A lesson is missing 'id'." }
  if (-not $l.title)  { throw "Lesson '$($l.id)' is missing 'title'." }
  if (-not $l.blocks) { throw "Lesson '$($l.id)' has no 'blocks'." }
}
Write-Host "Read $($incoming.Count) lesson(s) from $Path" -ForegroundColor Cyan

$row = Invoke-RestMethod -Uri "$U/rest/v1/matrix?id=eq.school&select=data" -Headers $H -Method Get
if (-not $row) { throw "No 'school' row yet. Open the dashboard once so it seeds itself." }
$data = $row[0].data

$existing = @()
if ($data.PSObject.Properties.Name -contains 'lessons' -and $data.lessons) { $existing = @($data.lessons) }
Write-Host "Row currently holds $($existing.Count) lesson(s)."

if ($Replace) {
  $merged = $incoming
  Write-Host "Replacing the queue." -ForegroundColor Yellow
} else {
  $have = @{}
  foreach ($l in $existing) { $have[$l.id] = $true }
  $new = @($incoming | Where-Object { -not $have.ContainsKey($_.id) })
  $merged = @($existing) + $new
  Write-Host "Adding $($new.Count) new, skipping $($incoming.Count - $new.Count) already present."
}

$stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$data | Add-Member -NotePropertyName lessons -NotePropertyValue $merged -Force
if ($data.PSObject.Properties.Name -notcontains 'lessonLog') {
  $data | Add-Member -NotePropertyName lessonLog -NotePropertyValue (New-Object PSObject) -Force
}
$data.updatedAt = $stamp

$body = @{ id = 'school'; data = $data; updated_at = $stamp } | ConvertTo-Json -Depth 30 -Compress
Write-Host "Payload $([math]::Round($body.Length/1KB,1)) KB"

# Invoke-RestMethod encodes a -Body string with the default codepage, which
# mangles the em dashes and arrows in lesson text and makes PostgREST reject
# the whole document as invalid JSON. Send explicit UTF-8 bytes instead.
$bytes = [Text.Encoding]::UTF8.GetBytes($body)
$null = Invoke-RestMethod -Uri "$U/rest/v1/matrix" -Method Post -Body $bytes `
  -ContentType 'application/json; charset=utf-8' `
  -Headers ($H + @{ Prefer = 'resolution=merge-duplicates' })

Write-Host "Pushed. Queue is now $($merged.Count) lesson(s)." -ForegroundColor Green
Write-Host "Open dashboards pick this up in about 2 seconds." -ForegroundColor Green
