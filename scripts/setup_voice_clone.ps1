param(
    [ValidateSet('cuda', 'cpu')]
    [string]$Device = 'cuda',
    [string]$PythonLauncher = 'py'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$venvDir = Join-Path $repoRoot '.venv'
$venvPython = Join-Path $venvDir 'Scripts\python.exe'
$requirements = Join-Path $repoRoot 'python\requirements.txt'

if (-not (Test-Path -LiteralPath $venvPython)) {
    Write-Host 'Creating Python 3.11 virtual environment...'
    if ($PythonLauncher -eq 'py') {
        & py -3.11 -m venv $venvDir
    } else {
        & $PythonLauncher -m venv $venvDir
    }
    if ($LASTEXITCODE -ne 0) { throw 'Virtual environment creation failed.' }
}

& $venvPython -m ensurepip --upgrade
& $venvPython -m pip install --upgrade pip setuptools wheel

if ($Device -eq 'cuda') {
    Write-Host 'Installing PyTorch 2.6.0 with CUDA 12.4 support...'
    & $venvPython -m pip install torch==2.6.0+cu124 torchaudio==2.6.0+cu124 --index-url https://download.pytorch.org/whl/cu124
} else {
    Write-Host 'Installing CPU-only PyTorch 2.6.0...'
    & $venvPython -m pip install torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cpu
}
if ($LASTEXITCODE -ne 0) { throw 'PyTorch installation failed.' }

& $venvPython -m pip install -r $requirements
if ($LASTEXITCODE -ne 0) { throw 'Coqui TTS installation failed.' }

Write-Host 'Runtime diagnostics:'
& $venvPython (Join-Path $repoRoot 'python\voice_clone\diagnostics.py')

Write-Host ''
Write-Host 'Voice-clone runtime is installed.'
Write-Host 'Copy .env.example to .env, add GEMINI_API_KEY, and set COQUI_TOS_AGREED=1 only after reviewing the Coqui terms.'
