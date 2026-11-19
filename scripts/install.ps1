# Instala y levanta GameStats en Windows con Docker Desktop.
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1            (construye desde el código)
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -Release   (usa imágenes publicadas)
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -NoTest
param([switch]$Release, [switch]$NoTest)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

Write-Host '==> Verificando requisitos'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker no está instalado: https://docs.docker.com/desktop/' }
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop no está corriendo' }

Write-Host '==> Preparando carpetas de datos'
foreach ($dir in 'data\inbox\processed', 'data\inbox\rejected', 'data\results') {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

Write-Host '==> Levantando servicios'
if ($Release) {
    $env:COMPOSE_FILE = 'docker-compose.release.yml'
    docker compose pull
    if ($LASTEXITCODE -ne 0) { throw 'No se pudieron descargar las imágenes' }
    docker compose up -d --wait
} else {
    docker compose up -d --build --wait
}
if ($LASTEXITCODE -ne 0) { throw 'docker compose up falló; revisa: docker compose logs' }
docker compose ps

if (-not $NoTest) {
    Write-Host '==> Prueba de humo'
    $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    docker compose run --rm -T simulator -scenario all -matches 1 -interval 2ms -wait -timeout 3m -prefix "smoke_http_$stamp"
    if ($LASTEXITCODE -ne 0) { throw 'La simulación por HTTP falló' }
    docker compose run --rm -T simulator -mode files -scenario random -matches 1 -interval 20ms -wait -timeout 3m -prefix "smoke_files_$stamp"
    if ($LASTEXITCODE -ne 0) { throw 'La simulación por archivos falló' }
    $scalaBinding = docker compose port scala-analytics 8080
    if ($LASTEXITCODE -ne 0 -or -not $scalaBinding) { throw 'No se pudo consultar el puerto de Scala' }
    $scalaPort = (($scalaBinding | Select-Object -First 1).Trim() -split ':')[-1]
    $scalaUrl = "http://localhost:$scalaPort"
    $summary = Invoke-RestMethod "http://localhost:$scalaPort/stats/games"
    foreach ($game in 'MMA', 'FOOTBALL', 'MOTORCYCLE_RACING', 'FREE_FIRE') {
        if (-not $summary.$game) { throw "No hay estadísticas de $game" }
    }
    $summaryJson = $summary | ConvertTo-Json -Depth 10
    foreach ($pattern in 'FLURRY_KNOCKDOWN', 'TEAM_BUILDUP_GOAL', 'COMEBACK_AFTER_INCIDENT', 'THIRD_PARTY') {
        if ($summaryJson -notmatch "`"$pattern`"") { throw "No se detectó el patrón $pattern" }
    }
    if (-not (Get-ChildItem "data\results\smoke_http_${stamp}_*.json" -ErrorAction SilentlyContinue)) {
        throw 'Scala no guardó resultados en data\results'
    }

    $goBinding = docker compose port go-service 8081
    $consoleBinding = docker compose port console 5173
    $prologBinding = docker compose port prolog-service 8082
    if ($LASTEXITCODE -ne 0 -or -not $goBinding -or -not $consoleBinding -or -not $prologBinding) {
        throw 'No se pudieron consultar los puertos de Go, la consola y Prolog'
    }
    $goPort = (($goBinding | Select-Object -First 1).Trim() -split ':')[-1]
    $consolePort = (($consoleBinding | Select-Object -First 1).Trim() -split ':')[-1]
    $prologPort = (($prologBinding | Select-Object -First 1).Trim() -split ':')[-1]
    $goUrl = "http://localhost:$goPort"
    $consoleUrl = "http://localhost:$consolePort"
    $prologUrl = "http://localhost:$prologPort"
    $page = Invoke-WebRequest -UseBasicParsing "$consoleUrl/"
    if ($page.Content -notmatch '<title>GameConsole</title>') { throw 'La consola web no respondió correctamente' }
    $move = Invoke-RestMethod -Uri "$prologUrl/move" -Method Post -ContentType 'application/json' `
        -Body '{"board":["X","X","","O","","","","",""],"turn":"O"}'
    if ($move.position -ne 2) { throw 'Prolog no bloqueó la victoria inmediata' }

    $matchId = "smoke_memory_$stamp"
    $timestamp = [DateTimeOffset]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
    $startEvent = @{
        eventId = "${matchId}_start"; timestamp = $timestamp; gameId = 'MEMORY'; matchId = $matchId
        playerId = 'SYSTEM'; type = 'MATCH'; action = 'MATCH_STARTED'; data = @{ mode = 'SOLO'; pairs = 6 }
    } | ConvertTo-Json -Depth 5 -Compress
    Invoke-RestMethod -Uri "$goUrl/events" -Method Post -ContentType 'application/json' -Body $startEvent | Out-Null
    $partial = $null
    for ($attempt = 0; $attempt -lt 30 -and -not $partial; $attempt++) {
        try { $partial = Invoke-RestMethod -Uri "$scalaUrl/partial/$matchId" }
        catch { Start-Sleep -Seconds 1 }
    }
    if (-not $partial -or -not $partial.partial) { throw 'Scala no guardó el snapshot parcial' }
    $finishEvent = @{
        eventId = "${matchId}_finish"; timestamp = $timestamp; gameId = 'MEMORY'; matchId = $matchId
        playerId = 'SYSTEM'; type = 'MATCH'; action = 'MATCH_FINISHED'; data = @{ reason = 'ABANDONED' }
    } | ConvertTo-Json -Depth 5 -Compress
    Invoke-RestMethod -Uri "$goUrl/events" -Method Post -ContentType 'application/json' -Body $finishEvent | Out-Null
    $result = $null
    for ($attempt = 0; $attempt -lt 30 -and -not $result; $attempt++) {
        try { $result = Invoke-RestMethod -Uri "$scalaUrl/results/$matchId" }
        catch { Start-Sleep -Seconds 1 }
    }
    if (-not $result) { throw 'Scala no guardó el resultado final del snapshot' }
    $instances = Invoke-RestMethod -Uri "$goUrl/stats/instances"
    if ($instances.byGame.MEMORY.started -lt 1) { throw 'Go no reporta conteos de Memoria' }
    Write-Host 'OK: consola, Prolog, Go y Scala integrados; resultados en data\results'
}

Write-Host ''
Write-Host 'GameStats está listo:'
Write-Host '  Consola web:       http://localhost:5173'
Write-Host '  Panel revisión:    http://localhost:8081/dashboard'
Write-Host '  Go (ingestión):    http://localhost:8081/   (/matches, /catalog, /inbox)'
Write-Host '  Scala (análisis):  http://localhost:8080/   (/results, /stats/games)'
Write-Host '  Prolog (Gato):     http://localhost:8082'
Write-Host '  Bandeja: .\data\inbox   Resultados: .\data\results'
Write-Host '  Generar partidas:  docker compose run --rm simulator -scenario random -matches 5 -wait'
Write-Host '  Detener:           docker compose down'
