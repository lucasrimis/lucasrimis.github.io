import pathlib
d = pathlib.Path(__file__).parent
html = (d / 'template.html').read_text()
import json, os
fb = (d / 'firebase.json').read_text() if (d / 'firebase.json').exists() else 'null'
html = html.replace('__FIREBASE__', fb)
html = html.replace('__WORLD__', (d / 'world.json').read_text()).replace('__ENGINE__', (d / 'engine.js').read_text())
import time
build = 'v' + time.strftime('%Y%m%d%H%M%S')
html = html.replace('__BUILD__', build)
(d / 'index.html').write_text(html)
# segundo mapa: Serrinha do Alambari (mesmo motor e página, outro mundo)
if (d / 'serrinha_world.json').exists():
    h2 = html.replace((d / 'world.json').read_text(), (d / 'serrinha_world.json').read_text())
    h2 = h2.replace('<title>Morada da Colina · Pixel 3D</title>', '<title>Serrinha do Alambari · Pixel 3D</title>')
    h2 = h2.replace('<div class="t">MORADA DA COLINA</div>', '<div class="t">SERRINHA DO ALAMBARI</div>').replace('RESENDE · RJ · DADOS OPENSTREETMAP', 'RESENDE · RJ · DADOS ABERTOS')
    # a página fica em serrinha/: manifesto, ícones, versão e service worker são os da pasta de cima
    h2 = h2.replace('href="manifest.json"', 'href="../manifest.json"').replace('href="icon-192.png"', 'href="../icon-192.png"')
    h2 = h2.replace('</head>', '<style>#online,#btnOnline,#btnHunt{display:none!important}</style></head>', 1)   # online só no bairro, por enquanto
    h2 = h2.replace('register("sw.js")', 'register("../sw.js")').replace('fetch("version.json?t="', 'fetch("../version.json?t="')
    (d / 'serrinha.html').write_text(h2)
    print('serrinha.html', len(h2) // 1024, 'KB')
(d / 'version.json').write_text(json.dumps({'v': build}))
(d / 'sw.js').write_text((d / 'sw_template.js').read_text().replace('__BUILD__', build))
print('index.html', len(html) // 1024, 'KB')
