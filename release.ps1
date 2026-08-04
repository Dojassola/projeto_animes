$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path

Push-Location $repo
try {
    if (git status --porcelain) { throw 'O repositorio precisa estar sem alteracoes pendentes.' }

    $branch = git branch --show-current
    if (-not $branch) { throw 'Nao e possivel publicar a partir de detached HEAD.' }

    $version = (Get-Content 'apps/desktop/package.json' -Raw | ConvertFrom-Json).version
    $tag = "v$version"
    if ($tag -notmatch '^v\d+\.\d+\.\d+$') { throw "Versao invalida: $version" }

    git rev-parse --verify --quiet "refs/tags/$tag" *> $null
    if ($LASTEXITCODE -eq 0) { throw "A tag $tag ja existe localmente." }

    corepack pnpm typecheck
    corepack pnpm lint
    corepack pnpm test
    corepack pnpm build

    git push origin $branch
    git tag -a $tag -m "Kitsune $version"
    git push origin $tag
    Write-Host "Release $tag enviada. O GitHub Actions publicara os instaladores."
} finally {
    Pop-Location
}
