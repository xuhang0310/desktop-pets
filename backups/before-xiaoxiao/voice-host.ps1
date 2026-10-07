param([string]$ElectronPath, [string]$AppDirectory, [switch]$Probe)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$AppDirectory = (Resolve-Path -LiteralPath $AppDirectory).Path
$ElectronPath = (Resolve-Path -LiteralPath $ElectronPath).Path
$runRoot = Join-Path $AppDirectory 'data/voice-runs'
if ($Probe) { $runRoot = Join-Path $AppDirectory 'preview/bridge-runs' }
[void][System.IO.Directory]::CreateDirectory($runRoot)
$bridge = Join-Path $runRoot ([Guid]::NewGuid().ToString('N'))
[void][System.IO.Directory]::CreateDirectory($bridge)
$env:WIDGET_VOICE_BRIDGE = $bridge
$env:ELECTRON_RUN_AS_NODE = $null
$speechScript = Join-Path $AppDirectory 'scripts/recognize-voice.ps1'
$shellExe = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$jobs = @{}
$exitCode = 1
function Write-Reply($id, $result) {
    Add-Content -LiteralPath (Join-Path $bridge ($id + '.jsonl')) -Value ($result | ConvertTo-Json -Compress) -Encoding UTF8
}
try {
    # The launcher owns the recognizer processes. No microphone is opened here.
    # They are siblings of Electron, independent of its process initialization.
    $entry = $AppDirectory
    if ($Probe) { $entry = Join-Path $AppDirectory 'voice-bridge-check.js' }
    $appArgs = @(('"' + $entry + '"'), '--no-sandbox')
    # Start-Process -RedirectStandardOutput 启动的进程在本机 Windows PowerShell 5.1 上
    # ExitCode 恒为 $null（已实测：退出后、Refresh 后均读不到），会让退出码兜底成 1。
    # 改经 cmd 包装：重定向照旧落盘，真实退出码用延迟展开写进 exitcode.txt。
    $outLog = Join-Path $bridge 'app-output.log'
    $errLog = Join-Path $bridge 'app-error.log'
    $ecFile = Join-Path $bridge 'exitcode.txt'
    $cmdLine = '/v /s /c ""' + $ElectronPath + '" "' + $entry + '" --no-sandbox 1> "' + $outLog + '" 2> "' + $errLog + '" & echo !ERRORLEVEL!>"' + $ecFile + '""'
    $widget = Start-Process -FilePath 'cmd.exe' -ArgumentList $cmdLine -WorkingDirectory $AppDirectory -WindowStyle Hidden -PassThru
    while (-not $widget.HasExited) {
        foreach ($file in @(Get-ChildItem -LiteralPath $bridge -Filter '*.request' -File)) {
            $id = $file.BaseName
            if ($id -notmatch '^[a-f0-9]{32}$') { continue }
            try { $request = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json }
            catch { continue }
            Remove-Item -LiteralPath $file.FullName
            if ($jobs.ContainsKey($id)) { continue }
            $mode = [string]$request.mode
            if ($mode -notin @('check', 'listen') -and -not ($Probe -and $mode -eq 'file')) { Write-Reply $id @{status='unsupported'}; continue }
            if ($mode -eq 'listen' -and @($jobs.Values | Where-Object {$_.mode -eq 'listen'}).Count -gt 0) { Write-Reply $id @{status='busy'}; continue }
            if ($jobs.Count -ge 2) { Write-Reply $id @{status='busy'}; continue }
            $output = Join-Path $bridge ($id + '.jsonl')
            $arguments = @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"'+$speechScript+'"'),'-Mode',$mode,'-ResultFile',('"'+$output+'"'))
            if ($mode -eq 'file') { $arguments += @('-WaveFile', ('"' + (Join-Path $AppDirectory 'preview/command-dance.wav') + '"')) }
            try {
                $worker = Start-Process -FilePath $shellExe -ArgumentList $arguments -WindowStyle Hidden -PassThru
                $jobs[$id] = @{ process=$worker; started=[DateTime]::UtcNow; mode=$mode }
            } catch { Write-Reply $id @{status='unavailable';detail=$_.Exception.Message} }
        }
        foreach ($id in @($jobs.Keys)) {
            $job = $jobs[$id]
            $cancel = Join-Path $bridge ($id + '.cancel')
            if (Test-Path -LiteralPath $cancel) {
                if (-not $job.process.HasExited) { $job.process.Kill(); $job.process.WaitForExit(1000) | Out-Null }
                Write-Reply $id @{status='cancelled'}
                Remove-Item -LiteralPath $cancel
                $jobs.Remove($id)
            } elseif (([DateTime]::UtcNow - $job.started).TotalSeconds -gt 14) {
                if (-not $job.process.HasExited) { $job.process.Kill() }
                Write-Reply $id @{status='timeout'}
                $jobs.Remove($id)
            } elseif ($job.process.HasExited) {
                $resultFile = Join-Path $bridge ($id + '.jsonl')
                $last = $null
                try { $last = (Get-Content -LiteralPath $resultFile -Encoding UTF8 | Select-Object -Last 1) | ConvertFrom-Json } catch {}
                if (-not $last -or $last.status -eq 'listening') { Write-Reply $id @{status='unavailable'} }
                $jobs.Remove($id)
            }
        }
        Start-Sleep -Milliseconds 80
        $widget.Refresh()
    }
    $widget.WaitForExit()
    $exitCode = 1
    try { $exitCode = [int]((Get-Content -LiteralPath $ecFile -Raw).Trim()) } catch { $exitCode = 1 }
} finally {
    foreach ($job in $jobs.Values) { if (-not $job.process.HasExited) { try { $job.process.Kill() } catch {} } }
    # Each run has its own directory. Keep diagnostic logs, remove only IPC files.
    foreach ($file in @(Get-ChildItem -LiteralPath $bridge -File)) {
        if ($file.Extension -in @('.request','.cancel','.jsonl','.tmp')) { Remove-Item -LiteralPath $file.FullName }
    }
}
exit $exitCode
