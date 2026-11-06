# Contribuindo

## Fluxo de trabalho

1. Crie uma branch a partir de `develop`:
   ```bash
   git checkout develop
   git pull
   git checkout -b feat/minha-feature
   ```

2. Faça suas mudanças seguindo os padrões do projeto (ver `README.md`).

3. Commits semânticos:
   ```bash
   git commit -m "feat(codigo): adiciona botão reenviar com cooldown"
   ```

4. Push e Pull Request para `develop`:
   ```bash
   git push origin feat/minha-feature
   ```

5. Após aprovação e testes, `develop` → `main` (deploy automático no GitHub Pages).

## Checklist de PR

- [ ] Testei o fluxo completo em aba anônima
- [ ] Naveguei só com teclado (Tab + Enter) e funcionou
- [ ] Testei com `prefers-reduced-motion` ativo
- [ ] Nenhum `console.log` esquecido no código
- [ ] Sem números mágicos — usei `CONFIG.*`
- [ ] Mensagens de erro respondem "o que fazer agora?"
- [ ] Atualizei `CHANGELOG.md` se for nova versão