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
(d / 'version.json').write_text(json.dumps({'v': build}))
(d / 'sw.js').write_text((d / 'sw_template.js').read_text().replace('__BUILD__', build))
print('index.html', len(html) // 1024, 'KB')
