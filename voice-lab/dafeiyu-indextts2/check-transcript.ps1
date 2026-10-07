param([Parameter(Mandatory=$true)][string]$AudioPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Speech
$installed = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | Where-Object { $_.Culture.Name -eq 'zh-CN' } | Select-Object -First 1
$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($installed.Id)
try {
    $grammar = New-Object System.Speech.Recognition.DictationGrammar
    $engine.LoadGrammar($grammar)
    $engine.SetInputToWaveFile((Resolve-Path -LiteralPath $AudioPath).Path)
    $gotResult = $false
    while ($true) {
        try { $result = $engine.Recognize([TimeSpan]::FromSeconds(10)) }
        catch {
            if ($gotResult -and $_.Exception.GetBaseException() -is [System.InvalidOperationException]) { break }
            throw
        }
        if ($null -eq $result) { break }
        $gotResult = $true
        @{text=$result.Text; confidence=$result.Confidence} | ConvertTo-Json -Compress
    }
} finally { $engine.Dispose() }
