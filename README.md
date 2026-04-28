# Comparador de Imagens Duplicadas

Aplicativo desktop em **Electron + React** para auditoria manual de grupos de imagens potencialmente duplicadas. Foi desenhado para máxima velocidade operacional, mínima fadiga visual e tomada de decisão rápida — interface premium em dark mode (paleta OKLCH), atalhos de teclado densos e leitura/gravação massiva direto em planilhas `.xlsx`/`.xlsm` (preservando macros, fórmulas, formatação e demais colunas).

> Caso de uso típico: revisão de evidências fotográficas de campo (vistorias, circuitos, cadastros) onde uma planilha já agrupa as fotos por ocorrência e o operador precisa decidir, em cada grupo, **qual imagem manter** e **quais marcar como duplicadas**.

[![Electron](https://img.shields.io/badge/Electron-31-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![ExcelJS](https://img.shields.io/badge/ExcelJS-4.4-217346)](https://github.com/exceljs/exceljs)
[![Node](https://img.shields.io/badge/Node-18%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-Win%20%7C%20macOS%20%7C%20Linux-lightgrey)](#empacotar)

---

## Sumário
- [Features](#features)
- [Pré-requisitos](#pré-requisitos)
- [Instalação](#instalação)
- [Executar em desenvolvimento](#executar-em-desenvolvimento)
- [Empacotar](#empacotar)
- [Como funciona](#como-funciona)
- [Atalhos de teclado](#atalhos-de-teclado)
- [Formato esperado da planilha](#formato-esperado-da-planilha)
- [Arquitetura](#arquitetura)
- [Decisões de performance](#decisões-de-performance)
- [Resolver de imagens remotas](#resolver-de-imagens-remotas)
- [Limitações conhecidas](#limitações-conhecidas)
- [Stack](#stack)
- [Estrutura de diretórios](#estrutura-de-diretórios)
- [Licença](#licença)

---

## Features

- **Wizard de configuração em 3 passos** — selecionar arquivo (diálogo nativo ou drag-and-drop), escolher folha, mapear colunas com auto-detecção por palavras-chave.
- **Grid configurável de 2 a 8 colunas** com cartões mostrando a imagem real, número, status, badge de tipo e tooltip de metadados (ID, circuito, observação, data).
- **Múltiplos "manter" por grupo** — sem limite imposto.
- **Pré-povoamento** dos status a partir de marcações já existentes na planilha (`MANTER`/`DUPLICADA`/`x`/`sim`/etc.).
- **Auto-save com debounce de 800 ms** direto no arquivo, preservando macros (`.xlsm`), fórmulas e demais colunas.
- **Indicador de gravação** (saving / saved / error / dirty) sempre visível no canto da tela.
- **Sidebar com progresso global** — % de grupos concluídos e % de imagens classificadas em toda a auditoria.
- **Modal de zoom** e **modo de comparação lado a lado** entre duas imagens do mesmo grupo.
- **Atalho "marcar 1ª como manter, demais como duplicadas"** — automatiza o caso mais comum.
- **Painel de preferências em tempo real (tweaks panel)** — ajuste do tom de acento (matiz OKLCH), densidade, número de colunas e auto-save, persistido em `localStorage`.
- **Resolver de imagens remotas** com cache em memória — dada uma URL HTML que contém múltiplas imagens (ex.: páginas SINAPI), escolhe a maior (por `Content-Length`) e aplica `Referer` automaticamente para domínios que exigem.
- **Recentes** — últimos arquivos abertos persistidos em `localStorage`.
- **100% offline** — React/ReactDOM/Babel são copiados localmente para `renderer/vendor/` no `postinstall`. O app não faz nenhuma requisição externa exceto para baixar imagens HTTP/HTTPS quando a planilha aponta para elas.

## Pré-requisitos
- **Node.js 18+** (recomendado 20 LTS)
- **npm** (vem com o Node)
- Windows, macOS ou Linux x64

## Instalação
```bash
npm install
```
O `postinstall` copia React, ReactDOM e `@babel/standalone` para `renderer/vendor/` — o app roda totalmente offline.

## Executar em desenvolvimento
```bash
npm run dev
```
Abre o Electron com DevTools em janela separada e logging habilitado.

## Empacotar
```bash
npm run build:win     # Windows (.exe NSIS + portable)
npm run build:mac     # macOS (.dmg)
npm run build:linux   # Linux (.AppImage)
```
Saída em `dist/`.

---

## Como funciona

### 1. Tela de configuração (Setup Wizard)
Três passos lineares:

1. **Selecionar arquivo** — diálogo nativo (`dialog.showOpenDialog`) ou drag-and-drop. Aceita `.xlsx`, `.xlsm`, `.csv`. Mostra os arquivos recentes (em `localStorage`).
2. **Escolher folha** — lista todas as folhas com contagem de linhas/colunas.
3. **Mapear colunas** — auto-detecta colunas por palavras-chave (`imagem`, `grupo`, `manter`, `duplicada`, `id`, `circuito`, `observacao`, `data`). O operador pode reescolher manualmente.

**Colunas obrigatórias:**
- **Imagem** — caminho absoluto, relativo (à pasta da planilha) ou URL `http(s)://`
- **Grupo** — qualquer string usada como ID do grupo (linhas com o mesmo valor formam um grupo)
- **Manter** — coluna onde o app gravará `MANTER` para imagens marcadas
- **Duplicada** — coluna onde o app gravará `DUPLICADA` para imagens marcadas

**Colunas opcionais** (aparecem como tooltip nos cards):
- **ID**, **Circuito**, **Observação**, **Data**

### 2. Comparador
- **Grid configurável** (2–8 colunas) de cartões com a imagem real, número, status (manter/duplicada), tooltip de metadados.
- **Zoom global** ajustável via footer (slider de escala da grid).
- **Sidebar** com progresso global, navegação entre grupos e botão de "Reconfigurar".
- **Concluir grupo** — só habilita quando todas as imagens do grupo estão classificadas. Marca o grupo como concluído, dispara gravação imediata e avança para o próximo.
- **Auto-save** — alterações são gravadas com debounce de 800 ms diretamente no arquivo (preserva macros em `.xlsm`).
- **Modais de zoom e comparação** (lado a lado, com `Esc` para fechar).

### 3. Painel de preferências
Acionável por botão flutuante (canto inferior direito). Permite ajustar em tempo real:
- Tom de acento (matiz OKLCH 0–360°) — toda a paleta deriva de `--hue`.
- Densidade (`comfortable` / `compact`).
- Colunas no grid (2–8).
- Auto-save (on/off).
- Atalhos rápidos: salvar agora, manter 1ª/duplicar demais, limpar grupo, reconfigurar planilha.

---

## Atalhos de teclado

| Tecla | Ação |
|---|---|
| `M` | Marcar imagem ativa como **manter** (toggle) |
| `D` | Marcar imagem ativa como **duplicada** (toggle) |
| `1`–`9`, `0` | Selecionar imagem por número |
| `←` `→` `↑` `↓` | Navegar entre imagens do grupo |
| `Z` | Abrir zoom da imagem ativa |
| `C` | Iniciar comparação lado a lado |
| `N` / `P` | Próximo / anterior grupo |
| `Enter` | Concluir grupo (se todas classificadas) |
| `Ctrl+S` / `⌘S` | Salvar agora |
| `Esc` | Fechar modal |

---

## Formato esperado da planilha

Linha 1 = cabeçalho. Cada linha subsequente = uma imagem. As colunas mapeadas para "Manter" e "Duplicada" são gravadas com `MANTER` ou `DUPLICADA` (ou vazio se a marcação for limpa). **Todas as outras colunas, fórmulas e macros (`.xlsm`) são preservadas** — o ExcelJS reescreve apenas as células alteradas.

Exemplo:

| imagem_url        | grupo_id | imagem_id | circuito     | observacao    | data        | status_manter | status_duplicada |
|-------------------|----------|-----------|--------------|---------------|-------------|---------------|------------------|
| C:\imgs\1.png     | G-001    | IMG-00001 | CIR-NORTE-01 | sem GPS       | 2026-04-12  |               |                  |
| C:\imgs\2.png     | G-001    | IMG-00002 | CIR-NORTE-01 | reenviada     | 2026-04-12  |               |                  |
| https://exemplo/3 | G-002    | IMG-00003 | CIR-SUL-04   |               | 2026-04-13  |               |                  |

Caminhos relativos são resolvidos a partir da pasta onde a planilha está. URLs `http(s)://` são carregadas direto. Caminhos `file://` são normalizados.

**Marcações pré-existentes reconhecidas** (case-insensitive): `manter`, `duplicada`, `keep`, `dup`, `duplicate`, `1`, `x`, `true`, `sim`.

---

## Arquitetura

```
electron/
  main.js              # janela, IPC, custom protocol app-image://, resolver remoto
  preload.js           # bridge contextIsolation (window.electronAPI)
  workers/
    xlsx-worker.js     # leitura/gravação ExcelJS em worker thread
renderer/
  index.html
  styles.css           # tema dark (OKLCH-based, --hue dinâmico)
  setup.css
  vendor/              # React + ReactDOM + Babel UMD (offline, copiado no postinstall)
  src/
    data.js            # helpers (formatadores, recents)
    setup.jsx          # wizard de 3 passos
    card.jsx           # cartão com imagem real (React.memo)
    chrome.jsx         # sidebar / header / footer
    modals.jsx         # zoom + compare side-by-side
    tweaks-panel.jsx   # painel de preferências em tempo real
    app.jsx            # orquestrador (estado, atalhos, persistência)
scripts/
  copy-vendor.js       # copia node_modules → renderer/vendor/ no postinstall
```

### Comunicação entre processos
- **Renderer → Main** via `contextBridge` (preload.js): `pickSpreadsheet`, `listSheets`, `listColumns`, `loadGroups`, `saveStatuses`, `resolveImage`, `resolveRemoteImage`, `platform`.
- **Main → Worker** via `worker_threads.postMessage`: todo I/O de planilha roda na worker, a UI nunca bloqueia.

## Decisões de performance

- **Worker thread** dedicada para todo I/O de planilha (ExcelJS é síncrono e pesado em arquivos grandes) — UI nunca bloqueia.
- **Custom protocol `app-image://`** serve imagens locais via `Buffer.from(path).toString('base64url')` na URL → resolve no main e usa `net.fetch(file://)`. Sem `webSecurity: false`, sem leak de paths absolutos para o renderer.
- **`React.memo`** no `Card` — em um grid de 12 cartões, só o card alterado re-renderiza.
- **`loading="lazy"` + `decoding="async"`** nos `<img>` — Chromium gerencia decodificação fora da thread principal.
- **Debounce de 800 ms** + agrupamento por linha — uma única gravação consolida várias marcações rápidas.
- **`autoMatchColumns`** evita re-trabalho do operador a cada planilha nova.
- **`backgroundThrottling: false`** — janela mantém FPS quando perde foco (operadores costumam alternar com Excel/Bridge).

## Resolver de imagens remotas

Para planilhas que apontam para páginas HTML (não imagens diretas) — caso comum em portais que mostram a foto dentro de um viewer com várias miniaturas — o app inclui um resolver no main process:

1. Faz `GET` na URL com `User-Agent` realista, segue redirects, limita a 1.5 MB de HTML.
2. Procura `<img class="zoom-image" src="...">` (padrão Slick/SINAPI). Se não encontrar, usa o primeiro `<img>` como fallback.
3. Para cada candidata, faz `HEAD` e ordena por `Content-Length` — escolhe a maior.
4. Cacheia o resultado por 30 minutos por URL.
5. Para domínios que exigem (`*.sinapi.com.br`), injeta automaticamente `Referer` da página de origem via `webRequest.onBeforeSendHeaders` — caso contrário a CDN devolve 404.

## Limitações conhecidas

- **`.xls` (formato binário Excel 97-2003)** não é suportado — converta para `.xlsx`.
- **Imagens muito grandes (>30 MB cada)** podem demorar para decodificar; considere reduzi-las.
- O app guarda o estado de "concluído por grupo" e recentes em `localStorage` — limpe via **Reconfigurar** se trocar de planilha.
- Ao arrastar arquivo, depende da propriedade `File.path` (Electron) — em builds futuros do Chromium pode ser necessário usar `webUtils.getPathForFile`.

## Stack

- **Electron 31** (Chromium + Node, com `contextIsolation` e `sandbox: false` apenas para o preload)
- **React 18** + **ReactDOM** carregados via UMD (sem bundler — Babel Standalone compila JSX em runtime)
- **ExcelJS 4.4** rodando em **`worker_threads`**
- **electron-builder 24** para empacotar (NSIS, portable, dmg, AppImage)
- Sem dependências de UI externa — CSS puro com paleta **OKLCH** dinâmica

## Estrutura de diretórios

```
.
├── electron/          # processo main + preload + worker
├── renderer/          # UI (HTML + CSS + JSX) — sem build step
│   ├── src/           # componentes React
│   └── vendor/        # React + Babel offline (gerado pelo postinstall)
├── scripts/
│   └── copy-vendor.js
├── package.json
├── .gitignore
└── README.md
```

## Licença

Projeto privado — `UNLICENSED`. Veja [`package.json`](./package.json). Para uso ou redistribuição, entre em contato com o autor.

---

Feito por **Nicory** · Fortaleza-BR
