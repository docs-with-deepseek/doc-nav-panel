# DocNav — сборка расширения
# Использование:
#   .\build.cmd          — сборка + упаковка .vsix
#   .\build.cmd compile  — только сборка
#   .\build.cmd package  — только упаковка
#   .\build.cmd clean    — очистить out/ и *.vsix

param(
    [ValidateSet("all", "compile", "package", "clean")]
    [string]$Action = "all"
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

function Step-Compile {
    Write-Host "=== Сборка ===" -ForegroundColor Cyan
    npm run compile
    if ($LASTEXITCODE -ne 0) { throw "Сборка не удалась" }
    Write-Host "Сборка завершена" -ForegroundColor Green
}

function Step-Package {
    Write-Host "=== Упаковка .vsix ===" -ForegroundColor Cyan
    npm run package
    if ($LASTEXITCODE -ne 0) { throw "Упаковка не удалась" }
    Get-ChildItem -LiteralPath $PSScriptRoot -Filter "*.vsix" | ForEach-Object {
        Write-Host "VSIX: $($_.Name) ($([math]::Round($_.Length / 1KB, 2)) KB)" -ForegroundColor Green
    }
}

function Step-Clean {
    Write-Host "=== Очистка ===" -ForegroundColor Cyan
    if (Test-Path -LiteralPath "$PSScriptRoot\out") {
        Remove-Item -Recurse -Force -LiteralPath "$PSScriptRoot\out"
        Write-Host "Удалено: out/" -ForegroundColor Yellow
    }
    Get-ChildItem -LiteralPath $PSScriptRoot -Filter "*.vsix" | ForEach-Object {
        Remove-Item -Force -LiteralPath $_.FullName
        Write-Host "Удалено: $($_.Name)" -ForegroundColor Yellow
    }
    Write-Host "Очистка завершена" -ForegroundColor Green
}

switch ($Action) {
    "clean"   { Step-Clean }
    "compile" { Step-Compile }
    "package" { Step-Package }
    "all"     { Step-Compile; Step-Package }
}
