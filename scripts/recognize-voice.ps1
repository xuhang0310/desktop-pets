param(
    [ValidateSet('check', 'listen', 'file')][string]$Mode = 'check',
    [string]$WaveFile = '',
    [string]$ResultFile = ''
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
function Reply($value) {
    $json = $value | ConvertTo-Json -Compress -Depth 4
    if ($ResultFile) { Add-Content -LiteralPath $ResultFile -Value $json -Encoding UTF8 }
    Write-Output $json
}
$recognizer = $null
$stage = 'engine-check'
try {
    Add-Type -AssemblyName System.Speech
    $installed = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() |
        Where-Object { $_.Culture.Name -eq 'zh-CN' } | Select-Object -First 1
    if (-not $installed) { Reply @{ status = 'unsupported'; supported = $false }; exit 0 }
    $stage = 'engine-create'
    $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine($installed.Id)
    if ($Mode -eq 'check') { Reply @{ status = 'ready'; supported = $true; language = $installed.Culture.Name }; exit 0 }

    $commands = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../voice-commands.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $phrases = [string[]]@($commands | ForEach-Object { $_.phrases })
    $choices = New-Object System.Speech.Recognition.Choices
    $choices.Add($phrases)
    $builder = New-Object System.Speech.Recognition.GrammarBuilder
    $builder.Culture = $installed.Culture
    $builder.Append($choices)
    $grammar = New-Object System.Speech.Recognition.Grammar($builder)
    $recognizer.LoadGrammar($grammar)
    $recognizer.InitialSilenceTimeout = [TimeSpan]::FromSeconds(7)
    $recognizer.BabbleTimeout = [TimeSpan]::FromSeconds(7)
    $recognizer.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(500)
    $stage = 'audio-input'
    if ($Mode -eq 'file') {
        $recognizer.SetInputToWaveFile((Resolve-Path -LiteralPath $WaveFile).Path)
    } else {
        # The microphone is opened only for the explicitly requested one-shot.
        $recognizer.SetInputToDefaultAudioDevice()
    }
    Reply @{ status = 'listening' }
    $stage = 'recognize'
    $result = $recognizer.Recognize([TimeSpan]::FromSeconds(8))
    if (-not $result) { Reply @{ status = 'no-speech' }; exit 0 }
    if ($result.Confidence -lt 0.45) { Reply @{ status = 'unclear' }; exit 0 }
    $command = $commands | Where-Object { $_.phrases -contains $result.Text } | Select-Object -First 1
    if (-not $command) { Reply @{ status = 'unclear' }; exit 0 }
    Reply @{ status = 'recognized'; id = $command.id; text = $result.Text; confidence = $result.Confidence }
} catch {
    $cause = $_.Exception.GetBaseException()
    Reply @{ status = 'unavailable'; supported = $false; errorCode = $cause.HResult; detail = $cause.Message; stage = $stage }
    exit 1
} finally {
    if ($null -ne $recognizer) { $recognizer.Dispose() }
}
