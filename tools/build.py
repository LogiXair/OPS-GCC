#!/usr/bin/env python3
"""Concatenate src/ into one self-contained page: dist/logixair-gulf-twin.html (artifact body, no <html>/<head>)."""
import glob, os, sys, base64, io
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rd = lambda p: open(os.path.join(root, p), encoding='utf-8').read()
js = '\n'.join('/* ===== %s ===== */\n%s' % (os.path.basename(f), open(f, encoding='utf-8').read()) for f in sorted(glob.glob(os.path.join(root, 'src/js/*.js'))))
logo = ''
lp = os.path.join(root, 'src/logo.b64')
if os.path.exists(lp): logo = open(lp).read().strip()
html = rd('src/head.html') + '\n' + rd('src/body.html').replace('%%LOGO%%', logo) + '\n' + \
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>\n<script>\n(function(){\n"use strict";\n' + js + '\n})();\n</script>\n'
os.makedirs(os.path.join(root, 'dist'), exist_ok=True)
out = os.path.join(root, 'dist/logixair-gulf-twin.html')
open(out, 'w', encoding='utf-8').write(html)
# local test wrapper with the same skeleton the publisher adds
open(os.path.join(root, 'dist/local.html'), 'w', encoding='utf-8').write(
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
    '<style>:root{color-scheme:light;padding:env(safe-area-inset-top,0) 0 env(safe-area-inset-bottom,0)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style>'
    '</head><body>' + html + '</body></html>')
# GitHub Pages page: a complete document
open(os.path.join(root, 'index.html'), 'w', encoding='utf-8').write(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
    '<title>LogiXair Gulf Operations Twin</title><meta name="description" content="LogiXair cargo VTOL operations in Saudi Arabia and the Gulf: middle-mile, offshore, Red Sea islands and desert oil camps, as one continuous record.">'
    '<style>:root{color-scheme:dark;padding:env(safe-area-inset-top,0) 0 env(safe-area-inset-bottom,0)}html,body{background:#07090C}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style>'
    '</head><body>' + html + '</body></html>')
print('built', out, '%.0f KB' % (len(html.encode()) / 1024), 'js lines', js.count('\n'))
