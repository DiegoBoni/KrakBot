#Requires -Version 5
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

# ─── Banner ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  _  _____         _    ____        _          " -ForegroundColor Cyan
Write-Host " | |/ / _ \ __ _| | _| __ )  ___ | |_        " -ForegroundColor Cyan
Write-Host " | ' /|  _// _' | |/ /  _ \ / _ \| __|       " -ForegroundColor Cyan
Write-Host " | . \| | | (_| |   <| |_) | (_) | |_        " -ForegroundColor Cyan
Write-Host " |_|\_\_|  \__,_|_|\_\____/ \___/ \__|       " -ForegroundColor Cyan
Write-Host ""
Write-Host "              octopus+lightning  Installer              " -ForegroundColor Cyan
Write-Host ""

function Write-Info    { param($msg) Write-Host "  > $msg" -ForegroundColor Cyan }
function Write-Ok      { param($msg) Write-Host "  + $msg" -ForegroundColor Green }
function Write-Warn    { param($msg) Write-Host "  ! $msg" -ForegroundColor Yellow }
function Write-Fail    { param($msg) Write-Host "  x $msg" -ForegroundColor Red }

# ─── Node.js check / install ──────────────────────────────────────────────────
$nodeOk = $false
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue

if ($nodeCmd) {
    $nodeVersion = node -e "console.log(parseInt(process.versions.node))" 2>$null
    if ([int]$nodeVersion -ge 18) {
        Write-Ok "Node.js $(node -v) — OK"
        $nodeOk = $true
    } else {
        Write-Warn "Node.js $nodeVersion < 18, necesitamos actualizar"
    }
}

if (-not $nodeOk) {
    Write-Info "Instalando Node.js LTS..."

    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Info "Usando winget..."
        try {
            winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
            # Refresh PATH
            $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
            $userPath    = [System.Environment]::GetEnvironmentVariable("Path", "User")
            $env:Path    = "$machinePath;$userPath"
            Write-Ok "Node.js instalado: $(node -v)"
            $nodeOk = $true
        } catch {
            Write-Warn "winget falló: $_"
        }
    }

    if (-not $nodeOk) {
        Write-Warn "winget no disponible o falló."
        Write-Host ""
        Write-Host "  Descargá e instalá Node.js manualmente desde:" -ForegroundColor Yellow
        Write-Host "  https://nodejs.org/en/download" -ForegroundColor Cyan
        Write-Host ""
        Read-Host "  Presioná Enter cuando hayas instalado Node.js"

        # Refresh PATH after manual install
        $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
        $userPath    = [System.Environment]::GetEnvironmentVariable("Path", "User")
        $env:Path    = "$machinePath;$userPath"

        $nodeCmd2 = Get-Command node -ErrorAction SilentlyContinue
        if ($nodeCmd2) {
            Write-Ok "Node.js detectado: $(node -v)"
            $nodeOk = $true
        } else {
            Write-Fail "Node.js no encontrado. Volvé a ejecutar el script después de instalarlo."
            Read-Host "Presioná Enter para salir"
            exit 1
        }
    }
}

# ─── Clone repo if needed ─────────────────────────────────────────────────────
$installDir = Join-Path $env:USERPROFILE ".krakbot"

if (-not (Test-Path "installer\server.js")) {
    $pkgJson = Join-Path (Get-Location) "package.json"
    $isKrakbot = (Test-Path $pkgJson) -and ((Get-Content $pkgJson -Raw) -match "krakbot")

    if ($isKrakbot) {
        Write-Ok "Usando directorio actual: $(Get-Location)"
    } else {
        Write-Info "Clonando KrakBot en $installDir..."
        $git = Get-Command git -ErrorAction SilentlyContinue
        if ($git) {
            git clone --depth 1 https://github.com/DiegoBoni/KrakBot $installDir
            if ($LASTEXITCODE -ne 0) {
                Write-Fail "No se pudo clonar el repositorio. Verificá tu conexión."
                Read-Host "Presioná Enter para salir"
                exit 1
            }
            Set-Location $installDir
            Write-Ok "Repositorio clonado en $installDir"
        } else {
            Write-Fail "Git no encontrado. Descargá el repositorio manualmente:"
            Write-Host "  https://github.com/DiegoBoni/KrakBot" -ForegroundColor Cyan
            Read-Host "Presioná Enter para salir"
            exit 1
        }
    }
}

# ─── Launch installer server ──────────────────────────────────────────────────
Write-Info "Iniciando KrakBot Installer..."

$server = Start-Process -FilePath "node" `
    -ArgumentList "installer/server.js" `
    -PassThru `
    -NoNewWindow

Start-Sleep -Seconds 2

# ─── Open browser ─────────────────────────────────────────────────────────────
$url = "http://localhost:7337"
try {
    Start-Process $url
} catch {
    Write-Warn "No se pudo abrir el browser automáticamente."
}

Write-Host ""
Write-Host "  Si el browser no abre, visitá: $url" -ForegroundColor Green
Write-Host "  Mantené esta terminal abierta mientras usás el instalador." -ForegroundColor Yellow
Write-Host ""

# ─── Wait for server ─────────────────────────────────────────────────────────
try {
    $server.WaitForExit()
} finally {
    if (-not $server.HasExited) {
        $server.Kill()
    }
}
