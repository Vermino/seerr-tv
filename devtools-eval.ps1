# Evaluate a JS expression in the running Seerr TV WebView via the DevTools protocol.
# Usage: powershell -File devtools-eval.ps1 -Expr "document.title"
param([Parameter(Mandatory=$true)][string]$Expr, [int]$Port = 18222)
$ErrorActionPreference = 'Stop'

# Find the first real page target (skip about:blank / service workers).
$list = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 5
$page = $list | Where-Object { $_.type -eq 'page' -and $_.url -notlike 'about:*' } | Select-Object -First 1
if (-not $page) { Write-Output "NO_PAGE"; exit 1 }
$wsUrl = $page.webSocketDebuggerUrl

$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ct = [System.Threading.CancellationToken]::None
$ws.ConnectAsync([Uri]$wsUrl, $ct).Wait(5000) | Out-Null

$payload = @{
  id = 1
  method = 'Runtime.evaluate'
  params = @{ expression = $Expr; returnByValue = $true; awaitPromise = $true }
} | ConvertTo-Json -Depth 8 -Compress

$bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
$seg = New-Object System.ArraySegment[byte] (,$bytes)
$ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct).Wait(5000) | Out-Null

$buf = New-Object byte[] 131072
$sb = New-Object System.Text.StringBuilder
do {
  $rseg = New-Object System.ArraySegment[byte] (,$buf)
  $res = $ws.ReceiveAsync($rseg, $ct)
  $res.Wait(5000) | Out-Null
  [void]$sb.Append([System.Text.Encoding]::UTF8.GetString($buf, 0, $res.Result.Count))
} while (-not $res.Result.EndOfMessage)

$ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, '', $ct).Wait(2000) | Out-Null

$obj = $sb.ToString() | ConvertFrom-Json
if ($obj.result.result.value -ne $null) { Write-Output $obj.result.result.value }
elseif ($obj.result.exceptionDetails) { Write-Output ("EXC: " + $obj.result.exceptionDetails.exception.description) }
else { Write-Output ($obj.result.result | ConvertTo-Json -Compress) }
