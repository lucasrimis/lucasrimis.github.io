# Morada da Colina · Pixel 3D

Jogo 3D em pixel art do bairro Morada da Colina (Resende, RJ), feito a partir de dados reais.

**Jogar:** https://lucasrimis.github.io/morada-da-colina/

**Link alternativo (Cloudflare Pages, atualiza sozinho a cada push):** https://morada-da-colina.pages.dev/

## Instalar no celular
- **Android (Chrome):** abra o link e toque em **📲 INSTALAR O JOGO** na tela inicial do jogo (ou no menu ⋮ → *Instalar app*).
- **iPhone (Safari):** toque em **Compartilhar** → **Adicionar à Tela de Início**.
- O jogo instalado abre em tela cheia, funciona sozinho sem internet depois da primeira visita e se atualiza automaticamente.

## Controles
- **Computador:** WASD / setas para andar, Shift corre, C entra e sai do carro, arrastar o mouse gira a câmera, roda do mouse dá zoom, M abre o mapa, B abre o álbum de memórias (fotos e vídeos já encontrados), V alterna entre primeira e terceira pessoa (clique na tela para travar o mouse).
- **Celular:** joystick no lado esquerdo da tela, arrastar no lado direito gira a câmera, dois dedos dão zoom, botão 👁 alterna primeira/terceira pessoa.

## Esconde-esconde
Na tela inicial, **ESCONDE-ESCONDE** cria uma sala com código de 6 letras (ou entra numa). O dono da sala começa a partida e o pegador é sorteado.
- Quem se esconde chega perto de um objeto do cenário (lixeira, poste, carro, arbusto, banquinho…) e toca em **VIRAR** para virar uma cópia dele. **TRAVAR** impede de se mexer sem querer; **PROVOCAR** solta um assobio (e é automático a cada 60 s).
- O pegador fica com a tela preta enquanto os outros se escondem e depois atira mirando com o centro da tela. Errar custa 10 de vida.
- Computador: Espaço = virar/atirar, T = travar, G = provocar.
- As regras do Firebase estão em `fonte/firebase_rules.json`.

## Serrinha do Alambari (segundo mapa, primeira versão)
- No bairro, o ponto de ônibus fica na **Av. Professor Darcy Ribeiro**, na calçada do lado da igreja. Chegando perto aparece **🚌 PEGAR O ÔNIBUS PARA A SERRINHA**: o ônibus encosta, a tela mostra a viagem num mapa em pixel art e o jogo continua no **Pórtico da Serrinha**, dentro do ônibus, até a praça (7,3 km; dá para ⏩ acelerar ou ⏭ pular).
- Da praça, o caminho até o **Poço do Céu** (2,2 km) segue a estrada e a trilha reais. Para voltar, o ônibus fica parado no ponto da praça.
- Página: `serrinha/` (gerada por `fonte/prep_serrinha.py` + `fonte/build.py`). Por enquanto o modo online fica só no bairro.
- Dados: estradas, trilhas, rios e nomes © colaboradores do OpenStreetMap (ODbL); relevo SRTM (Terrarium, AWS Open Data); cobertura do solo ESA WorldCover 2021 (© ESA WorldCover project / CC-BY 4.0). Casas e árvores são geradas a partir desses dados. Os dados brutos ficam no branch `dados-serrinha`, baixados pela tarefa `.github/workflows/serrinha-dados.yml`.

## Dados
- Ruas, áreas verdes e lago: © colaboradores do OpenStreetMap (ODbL).
- Relevo: SRTM 30 m.
- Casas, árvores e detalhes de rua: gerados ou recriados a partir de referências visuais.

## Fonte
A pasta `fonte/` tem o código: `prep.py` processa os dados em `world.json`, `engine.js` é o motor 3D (WebGL puro) e `build.py` junta tudo em `index.html`.
