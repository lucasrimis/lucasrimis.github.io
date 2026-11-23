# Cabo (chechuda)

Jogo de cartas de memória baseado no **Cabo**: espie, espione, troque às cegas e grite **CABO!** quando achar que tem a menor soma.

**Jogar:** https://lucasrimis.github.io/cabo/

**Link alternativo (Cloudflare Pages, atualiza sozinho a cada push):** https://cabo-chechuda.pages.dev/

Código e histórico: https://github.com/lucasrimis/cabo

## Instalar no celular
- **Android (Chrome) ou computador:** abra o link e toque em **📲 Instalar o jogo** na tela inicial (ou no menu ⋮ → *Instalar app*).
- **iPhone (Safari):** toque em **Compartilhar** → **Adicionar à Tela de Início**.
- O jogo instalado abre em tela cheia, funciona sem internet contra os bots depois da primeira visita e se atualiza sozinho.

## Como jogar

- Baralho de 52 cartas, de 0 a 13. Cada jogador recebe 4 cartas viradas para baixo, lado a lado.
- No início de cada rodada, escolha 2 das suas cartas para espiar — e decore!
- Na sua vez, compre do monte (só você vê a carta) ou pegue a carta do descarte, e troque por uma das suas.
- **Troca múltipla:** troque de uma vez 2 ou mais cartas suas de mesmo valor. Se errar, fica com uma carta a mais.
- Ao descartar uma carta comprada do monte, use o poder dela:
  - **7–8 olhar** uma carta sua
  - **9–10 espiar** uma carta de outro jogador
  - **11–12 trocar** às cegas uma carta sua com a de outro jogador
- Grite **CABO** no começo da sua vez: os outros jogam mais uma vez e depois todos revelam.
- Quem chamou e tem a menor soma (ou empata) marca 0; se não, marca a soma + 10.
- **Kamikaze:** dois 12 e dois 13 = 0 para você, 50 para todos os outros.
- Chegou a exatamente 100? Volta para 50 (uma vez por jogo). O jogo acaba quando alguém passa de 100; vence o menor total.

## Modos

- **Contra bots** (1 a 3 adversários, três velocidades) — funciona aqui no GitHub Pages.
- **Online com código de sala** (até 4 na mesa) — quem cria a sala passa o código de 6 letras e os outros entram com ele. Os navegadores ligam-se diretamente (PeerJS/WebRTC); dentro do Claude usa as salas do Claude.

Idiomas: português, inglês e alemão. Tudo num único `index.html`, sem dependências além das fontes do Google.
