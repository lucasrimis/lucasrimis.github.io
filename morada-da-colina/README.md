# Morada da Colina · Pixel 3D

Jogo 3D em pixel art do bairro Morada da Colina (Resende, RJ), feito a partir de dados reais.

**Jogar:** https://lucasrimis.github.io/morada-da-colina/

## Controles
- **Computador:** WASD / setas para andar, Shift corre, C entra e sai do carro, arrastar o mouse gira a câmera, roda do mouse dá zoom, M abre o mapa.
- **Celular:** joystick no lado esquerdo da tela, arrastar no lado direito gira a câmera, dois dedos dão zoom.

## Dados
- Ruas, áreas verdes e lago: © colaboradores do OpenStreetMap (ODbL).
- Relevo: SRTM 30 m.
- Casas, árvores e detalhes de rua: gerados ou recriados a partir de referências visuais.

## Fonte
A pasta `fonte/` tem o código: `prep.py` processa os dados em `world.json`, `engine.js` é o motor 3D (WebGL puro) e `build.py` junta tudo em `index.html`.
