# Morada da Colina · Pixel 3D

Jogo 3D em pixel art do bairro Morada da Colina (Resende, RJ), feito a partir de dados reais.

**Jogar:** https://lucasrimis.github.io/morada-da-colina/

**Link alternativo (Cloudflare Pages, atualiza sozinho a cada push):** https://morada-da-colina.pages.dev/

## Controles
- **Computador:** WASD / setas para andar, Shift corre, C entra e sai do carro, arrastar o mouse gira a câmera, roda do mouse dá zoom, M abre o mapa, V alterna entre primeira e terceira pessoa (clique na tela para travar o mouse).
- **Celular:** joystick no lado esquerdo da tela, arrastar no lado direito gira a câmera, dois dedos dão zoom, botão 👁 alterna primeira/terceira pessoa.

## Esconde-esconde
Na tela inicial, **ESCONDE-ESCONDE** cria uma sala com código de 6 letras (ou entra numa). O dono da sala começa a partida e o pegador é sorteado.
- Quem se esconde chega perto de um objeto do cenário (lixeira, poste, carro, arbusto, banquinho…) e toca em **VIRAR** para virar uma cópia dele. **TRAVAR** impede de se mexer sem querer; **PROVOCAR** solta um assobio (e é automático a cada 60 s).
- O pegador fica com a tela preta enquanto os outros se escondem e depois atira mirando com o centro da tela. Errar custa 10 de vida.
- Computador: Espaço = virar/atirar, T = travar, G = provocar.
- As regras do Firebase estão em `fonte/firebase_rules.json`.

## Dados
- Ruas, áreas verdes e lago: © colaboradores do OpenStreetMap (ODbL).
- Relevo: SRTM 30 m.
- Casas, árvores e detalhes de rua: gerados ou recriados a partir de referências visuais.

## Fonte
A pasta `fonte/` tem o código: `prep.py` processa os dados em `world.json`, `engine.js` é o motor 3D (WebGL puro) e `build.py` junta tudo em `index.html`.
