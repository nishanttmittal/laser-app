param(
  [Parameter(Mandatory = $true)]
  [string]$ConfigPath,

  [Parameter(Mandatory = $false)]
  [ValidateRange(5, 1440)]
  [int]$IntervalMinutes = 15,

  [Parameter(Mandatory = $false)]
  [string]$TaskName = "UNICO Laser Program Sync"
)

$ErrorActionPreference = "Stop"
$runner = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "Invoke-LaserProgramSync.ps1")).Path
$config = (Resolve-Path -LiteralPath $ConfigPath).Path
$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$runner`" -ConfigPath `"$config`""

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments
$trigger = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Read-only incremental TubePro/TubesT program manifest sync" `
  -RunLevel Limited `
  -Force | Out-Null

Write-Output "Installed scheduled task: $TaskName"
Write-Output "Interval: $IntervalMinutes minutes"
Write-Output "Config: $config"
