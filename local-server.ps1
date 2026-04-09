param(
  [int]$Port = 8934,
  [string]$DefaultPage = 'door-catalog-viewer.html'
)

$ErrorActionPreference = 'Stop'
$SiteRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)

$Mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.txt' = 'text/plain; charset=utf-8'
  '.png' = 'image/png'
  '.jpg' = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.gif' = 'image/gif'
  '.svg' = 'image/svg+xml'
  '.ico' = 'image/x-icon'
  '.litematic' = 'application/octet-stream'
  '.schem' = 'application/octet-stream'
  '.schematic' = 'application/octet-stream'
  '.nbt' = 'application/octet-stream'
}

function Write-BytesResponse($Response, [int]$StatusCode, [string]$ContentType, [byte[]]$Body) {
  $Response.StatusCode = $StatusCode
  $Response.ContentType = $ContentType
  $Response.Headers['Cache-Control'] = 'no-store, no-cache, must-revalidate'
  $Response.Headers['Pragma'] = 'no-cache'
  $Response.Headers['Expires'] = '0'
  $Response.ContentLength64 = $Body.Length
  if ($Body.Length -gt 0) {
    $Response.OutputStream.Write($Body, 0, $Body.Length)
  }
  $Response.OutputStream.Close()
}

function Write-TextResponse($Response, [int]$StatusCode, [string]$Text, [string]$ContentType = 'text/plain; charset=utf-8') {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
  Write-BytesResponse $Response $StatusCode $ContentType $bytes
}

function Write-JsonResponse($Response, [int]$StatusCode, $Object) {
  $json = $Object | ConvertTo-Json -Compress -Depth 8
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  Write-BytesResponse $Response $StatusCode 'application/json; charset=utf-8' $bytes
}

function Read-RequestBodyBytes($Request) {
  $stream = $Request.InputStream
  $memory = New-Object System.IO.MemoryStream
  $buffer = New-Object byte[] 8192
  while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
    $memory.Write($buffer, 0, $read)
  }
  $bytes = $memory.ToArray()
  $memory.Dispose()
  return $bytes
}

function Resolve-SafePath([string]$RelativePath) {
  $candidate = [System.IO.Path]::GetFullPath((Join-Path $SiteRoot $RelativePath))
  if (-not $candidate.StartsWith($SiteRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Invalid path'
  }
  return $candidate
}

$listener = [System.Net.HttpListener]::new()
$prefix = "http://localhost:$Port/"
$listener.Prefixes.Add($prefix)

try {
  $listener.Start()
} catch {
  Write-Host ("Failed to start server on port {0}. It may already be in use." -f $Port) -ForegroundColor Red
  exit 1
}

Write-Host ("Serving {0} at {1}" -f $SiteRoot, $prefix) -ForegroundColor Green

while ($listener.IsListening) {
  $context = $listener.GetContext()
  $request = $context.Request
  $response = $context.Response

  try {
    $requestPath = [System.Uri]::UnescapeDataString($request.Url.AbsolutePath.TrimStart('/'))
    if ([string]::IsNullOrWhiteSpace($requestPath)) {
      $requestPath = $DefaultPage
    }

    if ($requestPath -eq '__write-json') {
      if ($request.HttpMethod -ne 'POST') {
        Write-TextResponse $response 405 '405 Method Not Allowed'
        continue
      }
      $bodyBytes = Read-RequestBodyBytes $request
      [System.IO.File]::WriteAllBytes((Join-Path $SiteRoot 'doors.json'), $bodyBytes)
      Write-JsonResponse $response 200 @{ ok = $true }
      continue
    }

    if ($requestPath -eq '__upload') {
      if ($request.HttpMethod -ne 'POST') {
        Write-TextResponse $response 405 '405 Method Not Allowed'
        continue
      }

      $doorId = $request.Headers['X-Upload-Door-Id']
      $doorSize = $request.Headers['X-Upload-Door-Size']
      $format = $request.Headers['X-Upload-Format']
      $uploadFilename = $request.Headers['X-Upload-Filename']

      if ([string]::IsNullOrWhiteSpace($doorId) -or [string]::IsNullOrWhiteSpace($doorSize) -or [string]::IsNullOrWhiteSpace($format)) {
        Write-TextResponse $response 400 'Missing upload headers'
        continue
      }
      if ($doorSize -notin @('2x2', '3x3', '4x4') -or $format -notin @('litematic', 'schem', 'schematic', 'nbt')) {
        Write-TextResponse $response 400 'Invalid upload target'
        continue
      }

      $buffer = Read-RequestBodyBytes $request
      $safeDoorId = ($doorId -replace '[^a-zA-Z0-9_-]', '-')
      $dir = Resolve-SafePath(("schematics\{0}\{1}" -f $doorSize, $safeDoorId))
      [System.IO.Directory]::CreateDirectory($dir) | Out-Null

      $decodedName = ''
      if (-not [string]::IsNullOrWhiteSpace($uploadFilename)) {
        $decodedName = [System.Uri]::UnescapeDataString($uploadFilename)
      }
      $filename = [System.IO.Path]::GetFileName($decodedName)
      if ([string]::IsNullOrWhiteSpace($filename)) {
        $filename = "{0}.{1}" -f $safeDoorId, $format
      }

      $target = Join-Path $dir $filename
      [System.IO.File]::WriteAllBytes($target, $buffer)
      $relative = "./schematics/{0}/{1}/{2}" -f $doorSize, $safeDoorId, $filename
      Write-JsonResponse $response 200 @{ path = $relative; filename = $filename }
      continue
    }

    if ($request.HttpMethod -ne 'GET' -and $request.HttpMethod -ne 'HEAD') {
      Write-TextResponse $response 405 '405 Method Not Allowed'
      continue
    }

    $relativePath = $requestPath.Replace('/', '\')
    $candidate = Resolve-SafePath $relativePath

    if ((Test-Path -LiteralPath $candidate) -and (Get-Item -LiteralPath $candidate).PSIsContainer) {
      $candidate = Join-Path $candidate $DefaultPage
    }
    if (-not (Test-Path -LiteralPath $candidate)) {
      Write-TextResponse $response 404 '404 Not Found'
      continue
    }

    $ext = [System.IO.Path]::GetExtension($candidate).ToLowerInvariant()
    $contentType = $Mime[$ext]
    if (-not $contentType) { $contentType = 'application/octet-stream' }
    $body = if ($request.HttpMethod -eq 'HEAD') { [byte[]]::new(0) } else { [System.IO.File]::ReadAllBytes($candidate) }
    Write-BytesResponse $response 200 $contentType $body
  } catch {
    try {
      Write-TextResponse $response 500 $_.Exception.Message
    } catch {}
  }
}
