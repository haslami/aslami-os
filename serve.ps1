param([int]$Port = 8777, [string]$Root = "$PSScriptRoot")
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $Root at http://localhost:$Port/"
$mime = @{ ".html"="text/html"; ".js"="application/javascript"; ".css"="text/css"; ".json"="application/json"; ".svg"="image/svg+xml"; ".png"="image/png"; ".ico"="image/x-icon"; ".jpg"="image/jpeg" }
while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $rel = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if ([string]::IsNullOrEmpty($rel)) { $rel = "matrixcommandcenter/index.html" }

    # /api/ics?url=... — server-side fetch of the Brightspace calendar feed.
    # The browser can't read it directly: Brightspace sends no CORS header, so a
    # page on localhost is refused. Proxying here keeps the token off the wire
    # to anyone but Habib's own machine.
    $handled = $false
    if ($rel -eq "api/ics") {
      $handled = $true
      $ctx.Response.AddHeader("Access-Control-Allow-Origin", "*")
      $feed = $ctx.Request.QueryString["url"]
      try {
        if ([string]::IsNullOrEmpty($feed)) { throw "missing url parameter" }
        if ($feed -notmatch '^https://brightspace\.missouristate\.edu/') { throw "only brightspace.missouristate.edu is proxied" }
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $body = (New-Object Net.WebClient).DownloadString($feed)
        $ctx.Response.ContentType = "text/calendar"
        $bytes = [Text.Encoding]::UTF8.GetBytes($body)
      } catch {
        $ctx.Response.StatusCode = 502
        $ctx.Response.ContentType = "text/plain"
        $bytes = [Text.Encoding]::UTF8.GetBytes("ics proxy failed: $($_.Exception.Message)")
      }
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      $ctx.Response.Close()
    }

    if (-not $handled) {
    # Netlify publishes matrixcommandcenter/ as the site root, so /ledger/ must
    # resolve there too — otherwise links work in production and 404 locally.
    $path = Join-Path $Root (Join-Path "matrixcommandcenter" $rel)
    if (-not (Test-Path $path)) { $path = Join-Path $Root $rel }
    if (Test-Path $path -PathType Container) { $path = Join-Path $path "index.html" }
    if (Test-Path $path -PathType Leaf) {
      $bytes = [System.IO.File]::ReadAllBytes($path)
      $ext = [System.IO.Path]::GetExtension($path).ToLower()
      if ($mime.ContainsKey($ext)) { $ctx.Response.ContentType = $mime[$ext] }
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes("Not found: $rel")
      $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
    }
    $ctx.Response.Close()
    }
  } catch { }
}
