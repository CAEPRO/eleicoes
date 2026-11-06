# Urna Eletrônica — CA

Sistema de votação online para eleições de Centro Acadêmico, com autenticação por e-mail (código de 6 dígitos) e integração com Google Sheets via Apps Script.

## 🔗 Arquitetura

```
┌─────────────┐  JSONP  ┌──────────────────┐  Sheets  ┌────────────┐
│ index.html  │ ──────► │ Google Apps      │ ───────► │ Planilha   │
│ app.js      │         │ Script (doGet)   │          │ Google     │
│ styles.css  │ ◄────── │  + MailApp       │          │ (dados)    │
└─────────────┘         └──────────────────┘          └────────────┘
   GitHub Pages             Backend serverless            "BD"
```

- **Frontend:** estático, hospedado no GitHub Pages
- **Backend:** Google Apps Script (`doGet`, publicado como Web App)
- **Banco:** Google Sheets (abas `ELEITORES`, `CHAPAS`, `VOTOS`, `CONFIGURACOES`, `TENTATIVAS`)
- **Autenticação:** código de 6 dígitos enviado por e-mail (via `MailApp`)
- **Anti-duplicidade:** token UUID + marcação `VOTOU` + `LockService`

## 🚀 Setup

### 1. Frontend (este repositório)

```bash
git clone https://github.com/<seu-usuario>/urna-eletronica.git
cd urna-eletronica
# Abra index.html no navegador OU
# Sirva localmente: python3 -m http.server 8000
```

### 2. Backend (Apps Script)

1. Abra sua planilha no Google Sheets
2. **Extensões → Apps Script**
3. Cole o conteúdo do arquivo `apps-script.js` (fora deste repositório)
4. **Implantar → Nova implantação → Tipo: App da Web**
5. Copie a URL gerada e cole em `CONFIG.URL_APPS_SCRIPT` no `app.js`

### 3. Estrutura esperada das abas

| Aba | Colunas |
|---|---|
| `ELEITORES` | NOME, MATRICULA, EMAIL, STATUS (`VOTOU` ou vazio) |
| `CHAPAS` | NUMERO, PRESIDENTE, VICE, SECRETARIO, DIRETOR_FINANCEIRO, DIRETOR_MARKETING, DIRETOR_ENSINO, DIRETOR_EVENTOS, FOTO_* |
| `VOTOS` | OPCAO, TIMESTAMP (arredondado em 5 min) |
| `CONFIGURACOES` | STATUS_ELEICAO (`ABERTA` / `ENCERRADA` / `NAO_INICIADA`) |
| `TENTATIVAS` | MATRICULA, CODIGO, EXPIRA_EM, TENTATIVAS, BLOQUEADO_ATE, TOKEN, TOKEN_EXPIRA |

## 🎨 Metodologia de melhoria (F0–F6)

Este projeto segue uma metodologia em 6 fases, alinhada a princípios de UI/UX, acessibilidade e código limpo:

| Fase | Objetivo | Aplicado em |
|---|---|---|
| **F0 — Diagnóstico** | Inventariar problemas antes de mexer | Auditoria manual + checklist de a11y |
| **F1 — Clareza** | Microcopy sem ambiguidade | Mensagens de erro acionáveis, feedback de ações |
| **F2 — Robustez** | Casos extremos, rede, estado offline | Timeout explícito, guards de duplo envio, retry |
| **F3 — UI/UX** | Hierarquia, tipografia, espaçamento | Contraste ≥ 4.5:1, overflow de nomes, responsivo |
| **F4 — Acessibilidade** | Teclado, labels, ARIA, foco | `aria-live`, `sr-only`, `focus-visible`, foco gerenciado |
| **F5 — Motion** | Performance e `prefers-reduced-motion` | Animações ≤ 200ms, `transform`/`opacity` |
| **F6 — Padronização** | Constantes, funções puras, composição | `CONFIG`, `state`, mapa de ações por tela |

## 📐 Padrões de código

### Versionamento semântico (SemVer)

- **MAJOR** — quebra de contrato com o Apps Script
- **MINOR** — nova funcionalidade retrocompatível
- **PATCH** — correção de bug sem nova feature

### Commits (Conventional Commits)

```
feat(codigo): adiciona botão "Voltar" para identificação
fix(votacao): impede duplo envio em CONFIRMA
refactor(app): extrai constantes MAX_MATRICULA e MAX_CODIGO
a11y(html): associa label ao input de matrícula
perf(css): respeita prefers-reduced-motion
docs(readme): documenta fluxo F0-F6
```

### Branches

```
main        ← produção (GitHub Pages)
develop     ← integração contínua
feat/*      ← features
fix/*       ← correções
refactor/*  ← refatorações sem mudança de comportamento
a11y/*      ← melhorias de acessibilidade
docs/*      ← documentação
```

### Convenções de código

- **Constantes em `CONFIG`** — zero números mágicos
- **Estado em `state`** — um único objeto, não variáveis soltas
- **Funções puras** — formatação e busca isoladas
- **Handler map** — `acoesPorTela[state.telaAtiva][action]` em vez de `if/else` aninhado
- **Todo `catch`** — loga ou mostra mensagem acionável (nunca engole silenciosamente, exceto áudio opcional)
- **`state.enviando`** — guard contra duplo-clique em chamadas assíncronas

## 🧪 Testes manuais

Após qualquer mudança, teste em **aba anônima**:

- [ ] Matrícula válida (não votou) → código chega por e-mail com nome e e-mail mascarado visíveis
- [ ] Matrícula inexistente → mensagem de erro
- [ ] Matrícula que já votou → mensagem de erro
- [ ] `REENVIAR CÓDIGO` → botão desabilita por 60s com contador
- [ ] `← VOLTAR` na tela de código → volta para identificação com matrícula preservada
- [ ] Código errado 3× → bloqueio de 1h
- [ ] Código correto → entra na votação
- [ ] `CONFIRMA` com 0/1 dígito → mensagem "⚠ Digite os 2 dígitos"
- [ ] Duplo-clique em `CONFIRMAR` (tela confirmação) → registra só 1 voto
- [ ] Voto registrado → tela FIM com contador 15s + botão "Próximo eleitor"
- [ ] `prefers-reduced-motion` ativo (DevTools → Rendering) → animações desativadas
- [ ] Navegação só com teclado (Tab + Enter) → fluxo completo funciona
- [ ] Leitor de tela (NVDA/VoiceOver) → erros são anunciados via `aria-live`

## 🔒 Segurança

- Frontend é **público por design** — a URL do Apps Script não é segredo
- Rate limit no backend (CacheService): 5 tentativas de matrícula / 10 min, 60s de cooldown entre reenvios
- Token UUID expira em 65 min
- `LockService` protege contra condições de corrida no registro de voto
- E-mail mascarado (`abc*****@gmail.com`) mostra apenas os 3 primeiros caracteres

## 🐛 Troubleshooting

| Sintoma | Causa provável | Solução |
|---|---|---|
| `⚠ Não foi possível conectar` | Apps Script fora do ar ou URL errada | Verificar `CONFIG.URL_APPS_SCRIPT` |
| Código não chega | Cota diária do `MailApp` esgotada | Aguardar 24h ou trocar conta |
| `Código expirado` | Mais de 60 min desde o envio | Clicar em "Reenviar código" |
| `Bloqueado por 1 hora` | 3 tentativas erradas | Aguardar 1h |
| Votei mas não aparece na planilha | `CONFIGURACOES.STATUS_ELEICAO` ≠ `ABERTA` | Atualizar a aba |

## 📄 Licença

Uso interno do Centro Acadêmico. Todos os direitos reservados.