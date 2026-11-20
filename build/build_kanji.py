"""kanji.js: window.KANJI = {char: [meaning, jlptN (0=none), grade (1-6, 8=secondary, 0=none)]}
Source: KANJIDIC2 (EDRDG, CC BY-SA 4.0) via davidluzgouveia/kanji-data (JLPT N-levels from Jonathan Waller's lists)."""
import json, re, sys
src, words_js, out = sys.argv[1:4]
d = json.load(open(src, encoding='utf-8'))
s = open(words_js, encoding='utf-8').read()
used = set(re.findall(r'[一-鿿㐀-䶿]', s.split('window.VOCAB=')[1]))
res = {}
for ch, v in d.items():
    if ch not in used and not v.get('jlpt_new') and v.get('grade') not in (1, 2, 3, 4, 5, 6, 8):
        continue
    m = ', '.join(x for x in v['meanings'][:2] if 'Radical' not in x) or (v['meanings'][0] if v['meanings'] else '')
    g = v.get('grade') if v.get('grade') in (1, 2, 3, 4, 5, 6, 8) else 0
    res[ch] = [m, v.get('jlpt_new') or 0, g]
with open(out, 'w', encoding='utf-8') as fh:
    fh.write('/* Kanji meanings, grades, JLPT: KANJIDIC2 (EDRDG, CC BY-SA 4.0) via kanji-data; JLPT N-levels: Jonathan Waller. */\n')
    fh.write('window.KANJI=' + json.dumps(res, ensure_ascii=False, separators=(',', ':')) + ';\n')
print(len(res), sum(1 for v in res.values() if v[1]), sum(1 for v in res.values() if v[2]))
