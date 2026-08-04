# Kitsune

Aplicativo desktop local-first para descobrir animes, pesquisar releases no Nyaa,
baixar vídeos com WebTorrent e localizar legendas em PT-BR e outros idiomas.

## Tecnologias

- Electron, React e TypeScript estrito
- SQLite com migrations
- AniList e Jikan para catálogo e episódios
- Nyaa, Tokyo Toshokan e DarkMahou para releases, com preferência de idioma e deduplicação
- OpenSubtitles para legendas
- WebTorrent para downloads locais sem continuar semeando após a conclusão

## Desenvolvimento

Requisitos: Node.js 22.12 ou mais recente e Corepack habilitado.

```powershell
corepack pnpm install
corepack pnpm dev
```

Validação completa:

```powershell
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

Executável portátil para Windows:

```powershell
corepack pnpm build:portable
```

O resultado é criado em `apps/desktop/release/` e não deve ser versionado.

## Releases e atualizações

Atualize `apps/desktop/package.json`, faça o commit e publique com:

```powershell
.\release.ps1
```

O script valida o projeto e envia a tag `vX.Y.Z`. O GitHub Actions gera o instalador
NSIS, o executável portátil e `latest.yml`; instalações NSIS verificam novas versões
automaticamente no GitHub Releases.

## Estrutura

```text
apps/desktop/
  src/main/       Electron, banco, rede e processos privilegiados
  src/preload/    ponte IPC mínima e tipada
  src/renderer/   interface React
  src/shared/     schemas e contratos compartilhados
  tests/          testes automatizados
.github/          integração contínua
```

As decisões e o planejamento de arquitetura estão em
[`plano_app_anime_electron.md`](./plano_app_anime_electron.md).

## Dados locais

Banco, downloads, torrents, legendas, logs e credenciais ficam fora do repositório,
nos diretórios locais do aplicativo. Não publique arquivos `.env`, bancos SQLite ou
mídia baixada.
