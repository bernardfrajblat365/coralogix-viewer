param(
    [int]$Port = 8080,
    [string]$Root = $PSScriptRoot
)

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()

Write-Host "Coralogix Viewer: http://localhost:$Port/"
Write-Host "Press Ctrl+C to stop."

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $path = $context.Request.Url.LocalPath
        if ($path -eq "/") { $path = "/index.html" }

        $filePath = Join-Path $Root ($path.TrimStart("/") -replace "/", [IO.Path]::DirectorySeparatorChar)
        if (-not (Test-Path $filePath -PathType Leaf)) {
            $context.Response.StatusCode = 404
            $bytes = [Text.Encoding]::UTF8.GetBytes("Not found")
            $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
            $context.Response.Close()
            continue
        }

        $ext = [IO.Path]::GetExtension($filePath).ToLowerInvariant()
        $contentType = switch ($ext) {
            ".html" { "text/html; charset=utf-8" }
            ".css"  { "text/css; charset=utf-8" }
            ".js"   { "text/javascript; charset=utf-8" }
            ".csv"  { "text/csv; charset=utf-8" }
            default { "application/octet-stream" }
        }

        $bytes = [IO.File]::ReadAllBytes($filePath)
        $context.Response.ContentType = $contentType
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $context.Response.Close()
    }
}
finally {
    $listener.Stop()
}
