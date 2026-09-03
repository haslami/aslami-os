# Pushes a study pack into the dashboard.
#
#   powershell -ExecutionPolicy Bypass -File push-pack.ps1 -Path pack.json
#
# Validates before writing: every quiz/test question must have an "answer" that
# exactly matches one of its "choices", or the mode can never be scored.

param(
  [Parameter(Mandatory=$true)][string]$Path,
  [switch]$Replace   # drop all existing packs instead of merging
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$U = 'https://llrmrekixkrtxuyqsbwb.supabase.co'
$K = 'sb_publishable_jD7t0YZl64xkLAPYJOfOgQ_GBnROkJv'
$H = @{ apikey = $K; Authorization = "Bearer $K" }

if (-not (Test-Path $Path)) { throw "No pack at $Path" }
$incoming = Get-Content $Path -Raw -Encoding UTF8 | ConvertFrom-Json
if ($incoming -isnot [array]) { $incoming = @($incoming) }

$problems = @()
foreach ($p in $incoming) {
  if (-not $p.id)    { $problems += "a pack is missing 'id'" }
  if (-not $p.title) { $problems += "pack '$($p.id)' is missing 'title'" }
  foreach ($set in @(@{n='quiz';v=$p.quiz}, @{n='test';v=$p.test})) {
    $i = 0
    foreach ($q in $set.v) {
      $i++
      if (-not $q.choices) { $problems += "$($p.id) $($set.n)[$i] has no choices"; continue }
      if ($q.choices -notcontains $q.answer) {
        $problems += "$($p.id) $($set.n)[$i]: answer is not one of the choices -> '$($q.answer)'"
      }
    }
  }
}
if ($problems.Count) {
  Write-Host "Pack is not loadable:" -ForegroundColor Red
  $problems | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  throw "$($problems.Count) problem(s) found."
}

foreach ($p in $incoming) {
  Write-Host ("{0}: {1} guide, {2} cards, {3} match, {4} quiz, {5} test, {6} scenarios" -f `
    $p.title, $p.guide.Count, $p.cards.Count, $p.match.Count, $p.quiz.Count, $p.test.Count, $p.scenarios.Count) -ForegroundColor Cyan
}

$row = Invoke-RestMethod -Uri "$U/rest/v1/matrix?id=eq.school&select=data" -Headers $H -Method Get
if (-not $row) { throw "No 'school' row yet. Open the dashboard once so it seeds itself." }
$data = $row[0].data

$existing = @()
if ($data.PSObject.Properties.Name -contains 'packs' -and $data.packs) { $existing = @($data.packs) }

if ($Replace) {
  $merged = $incoming
  Write-Host "Replacing all packs." -ForegroundColor Yellow
} else {
  $ids = @($incoming | ForEach-Object { $_.id })
  $merged = @($existing | Where-Object { $ids -notcontains $_.id }) + $incoming
}

$stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$data | Add-Member -NotePropertyName packs -NotePropertyValue $merged -Force
if ($data.PSObject.Properties.Name -notcontains 'results') {
  $data | Add-Member -NotePropertyName results -NotePropertyValue (New-Object PSObject) -Force
}
$data.updatedAt = $stamp

$body = @{ id = 'school'; data = $data; updated_at = $stamp } | ConvertTo-Json -Depth 40 -Compress
Write-Host "Payload $([math]::Round($body.Length/1KB,1)) KB"
# Invoke-RestMethod encodes a -Body string with the default codepage, which
# mangles non-ASCII and makes PostgREST reject the whole document.
$bytes = [Text.Encoding]::UTF8.GetBytes($body)
$null = Invoke-RestMethod -Uri "$U/rest/v1/matrix" -Method Post -Body $bytes `
  -ContentType 'application/json; charset=utf-8' `
  -Headers ($H + @{ Prefer = 'resolution=merge-duplicates' })

Write-Host "Pushed. $($merged.Count) pack(s) in the dashboard." -ForegroundColor Green
