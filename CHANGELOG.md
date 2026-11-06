# Changelog

Todas as mudanças notáveis deste projeto são documentadas aqui.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Versionamento segue [SemVer](https://semver.org/lang/pt-BR/).

## [1.1.0] — 2026-11-06

### Adicionado
- Botão "Voltar" na tela de código (retorna para identificação)
- Botão "Reenviar código" com cooldown visual de 60s
- Botão "Próximo eleitor" + auto-reset de 15s na tela FIM
- Botão "Tentar novamente" na tela de status em caso de erro de rede
- Sistema de toast para mensagens não bloqueantes (substitui `alert()`)
- Feedback visual "⚠ Digite os 2 dígitos" ao CONFIRMA incompleto na votação
- Constantes centralizadas em `CONFIG`
- Funções puras `formatarNumeroChapa`, `encontrarChapa`, `montarCardIntegrante`, `montarListaChapas`
- `handler map` (`acoesPorTela`) substituindo cadeia de `if/else` em `handleAction`
- Focus management em mudança de tela (a11y)
- `aria-live`, `role="alert"` e `sr-only` nos inputs e mensagens (a11y)
- `focus-visible` em todos os botões e inputs
- `@media (prefers-reduced-motion: reduce)` desativando animações
- Suporte a nomes longos com `overflow-wrap`/`text-overflow` em todo o fluxo
- Contraste ajustado de `.email-mostrado` (font-size 15 → 16)

### Alterado
- Estado consolidado no objeto `state` (antes: variáveis globais soltas)
- `alert()` substituído por toast (UX não bloqueante)
- `.screen-header` com `align-items: center` (antes: `baseline`)
- Ações de tela isoladas em mapa declarativo

### Corrigido
- Duplo-clique em CONFIRMAR registrava dois votos (agora guard com `state.enviando`)
- Botão BRANCO na tela de votação permitia clicar antes de digitar (mantido disabled, mas com lógica mais clara)
- Mensagem de `CONFIRMA` na votação com <2 dígitos era silenciosa (agora mostra aviso e vibração de erro)

## [1.0.0] — 2026-10-15

### Adicionado
- Versão inicial do sistema
- Fluxo completo: identificação → código → votação → confirmação → FIM
- Autenticação por matrícula + código de 6 dígitos por e-mail
- Integração com Google Apps Script + Google Sheets
- Integração com Drive para fotos das chapas
- Sons via Web Audio API (tecla, erro, confirmação, fim)
- Rate limit no backend via CacheService