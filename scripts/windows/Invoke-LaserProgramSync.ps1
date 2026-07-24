param(
  [Parameter(Mandatory = $false)]
  [string]$ConfigPath = (Join-Path $PSScriptRoot "..\sync-agent.config.json")
)

$ErrorActionPreference = "Stop"
$resolvedConfig = (Resolve-Path -LiteralPath $ConfigPath).Path
$config = Get-Content -LiteralPath $resolvedConfig -Raw | ConvertFrom-Json
$nodePath = if ($config.nodePath) { [string]$config.nodePath } else { "node.exe" }
$syncScript = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\sync-machine-manifest.mjs")).Path

& $nodePath $syncScript "--config=$resolvedConfig"
exit $LASTEXITCODE
