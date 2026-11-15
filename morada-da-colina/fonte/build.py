import pathlib
d = pathlib.Path(__file__).parent
html = (d / 'template.html').read_text()
import json, os
fb = (d / 'firebase.json').read_text() if (d / 'firebase.json').exists() else 'null'
html = html.replace('__FIREBASE__', fb)
html = html.replace('__WORLD__', (d / 'world.json').read_text()).replace('__ENGINE__', (d / 'engine.js').read_text())
(d / 'index.html').write_text(html)
print('index.html', len(html) // 1024, 'KB')
