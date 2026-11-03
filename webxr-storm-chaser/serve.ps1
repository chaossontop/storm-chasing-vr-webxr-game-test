param(
    [int]$Port = 8080,
    [string]$Bind = "127.0.0.1",
    [string]$Root = $PSScriptRoot
)

$ErrorActionPreference = "Stop"
$rootFull = [System.IO.Path]::GetFullPath($Root)
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse($Bind), $Port)
$listener.Start()

Write-Host ""
Write-Host "  Storm Chaser VR is being served from:" -ForegroundColor Cyan
Write-Host "  $rootFull"
Write-Host ""
Write-Host "  Desktop:  http://localhost:$Port" -ForegroundColor Green
if ($Bind -ne "127.0.0.1") {
    Write-Host "  Headset:  http://<this-pc-ip>:$Port  (WebXR needs HTTPS unless localhost)" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "  Press Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""

$mime = @{
    ".html" = "text/html; charset=utf-8"
    ".js"   = "text/javascript; charset=utf-8"
    ".mjs"  = "text/javascript; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
    ".wasm" = "application/wasm"
}

function Send-Response($stream, [int]$status, [string]$reason, [string]$contentType, [byte[]]$body) {
    $head = "HTTP/1.1 $status $reason`r`n"
    $head += "Content-Type: $contentType`r`n"
    $head += "Content-Length: $($body.Length)`r`n"
    $head += "Cache-Control: no-store`r`n"
    $head += "Connection: close`r`n`r`n"
    $headBytes = [System.Text.Encoding]::ASCII.GetBytes($head)
    $stream.Write($headBytes, 0, $headBytes.Length)
    if ($body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
    $stream.Flush()
}

while ($true) {
    $client = $null
    try {
        $client = $listener.AcceptTcpClient()
        $stream = $client.GetStream()
        $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
        $requestLine = $reader.ReadLine()

        if ([string]::IsNullOrWhiteSpace($requestLine)) { continue }

        while ($true) {
            $line = $reader.ReadLine()
            if ($null -eq $line -or $line -eq "") { break }
        }

        $parts = $requestLine.Split(" ")
        if ($parts.Length -lt 2) {
            Send-Response $stream 400 "Bad Request" "text/plain" ([System.Text.Encoding]::UTF8.GetBytes("Bad request"))
            continue
        }

        $method = $parts[0].ToUpperInvariant()
        $target = $parts[1].Split("?")[0]
        if ($target -eq "/") { $target = "/index.html" }

        $relative = [System.Uri]::UnescapeDataString($target).TrimStart("/")
        $full = [System.IO.Path]::GetFullPath((Join-Path $rootFull $relative))
        $rootWithSep = $rootFull.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar

        if (-not ($full.StartsWith($rootWithSep, [System.StringComparison]::OrdinalIgnoreCase) -or $full -eq $rootFull)) {
            Send-Response $stream 403 "Forbidden" "text/plain" ([System.Text.Encoding]::UTF8.GetBytes("Forbidden"))
            continue
        }

        if (-not [System.IO.File]::Exists($full)) {
            Send-Response $stream 404 "Not Found" "text/plain" ([System.Text.Encoding]::UTF8.GetBytes("Not found: $relative"))
            continue
        }

        $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
        $type = $mime[$ext]
        if (-not $type) { $type = "application/octet-stream" }
        $bytes = [System.IO.File]::ReadAllBytes($full)

        if ($method -eq "HEAD") {
            Send-Response $stream 200 "OK" $type ([byte[]]::new(0))
        } else {
            Send-Response $stream 200 "OK" $type $bytes
        }

        Write-Host ("{0} {1} -> {2}" -f $method, $target, $full)
    }
    catch {
        if ($client) {
            try {
                $s = $client.GetStream()
                Send-Response $s 500 "Internal Server Error" "text/plain" ([System.Text.Encoding]::UTF8.GetBytes("Server error"))
            } catch { }
        }
    }
    finally {
        if ($client) { $client.Close() }
    }
}
