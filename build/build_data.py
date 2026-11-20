"""Build the compact vocabulary dataset from JMdict + wordfreq.

Output: words.js -> window.VOCAB = [[kanji, reading, gloss, pos, score, flags], ...]
score = Zipf frequency x10 (0-80ish); flags bit1 = JMdict common, bit2 = usually kana
"""
import json, math, re, sys
from collections import defaultdict
import wordfreq

SRC, OUT = sys.argv[1], sys.argv[2]

KJ = '一-鿿㐀-䶿々'
KANJI_RE = re.compile('[' + KJ + ']')
ODD_RE = re.compile(r'[A-Za-z0-9０-９Ａ-Ｚａ-ｚ・＝〇]|[\u4e00-\u9fff][\u30a1-\u30f4\u30fc]{1,2}$')
BAD_KANJI_TAGS = {'rK', 'sK', 'oK', 'iK', 'ik'}
BAD_KANA_TAGS = {'sk', 'ik', 'ok', 'rk'}
SKIP_MISC = {'arch', 'obs', 'rare', 'vulg', 'X', 'derog', 'dated'}

freq = wordfreq.get_frequency_dict('ja')

# MeCab splits conjugations (食べた -> 食べ + た, 書いた -> 書い + た), so a verb or
# i-adjective's frequency is the sum of the tokens that are its own conjugated stems only.
HIRA = re.compile('[\u3040-\u309f]')
ROWS = {'う': 'わいうえお', 'く': 'かきくけこ', 'ぐ': 'がぎぐげご', 'す': 'さしすせそ', 'つ': 'たちつてと',
        'ぬ': 'なにぬねの', 'ぶ': 'ばびぶべぼ', 'む': 'まみむめも', 'る': 'らりるれろ'}
EUPH = {'う': 'っ', 'つ': 'っ', 'る': 'っ', 'く': 'い', 'ぐ': 'い', 'ぬ': 'ん', 'ぶ': 'ん', 'む': 'ん', 'す': ''}

def stems(form, pos):
    base, last = form[:-1], form[-1]
    if not KANJI_RE.search(base):
        return None
    if any(p.startswith('v5') for p in pos) and last in ROWS:
        return [base + k for k in ROWS[last] + EUPH[last]]
    if any(p.startswith('v1') for p in pos) and last == 'る':
        return [base, base + 'る', base + 'れ', base + 'ろ', base + 'よ']
    if 'adj-i' in pos and last == 'い':
        return [base + k for k in ('い', 'く', 'かっ', 'けれ', 'かろ')]
    return None

def word_freq(form, pos):
    f = freq.get(form, 0.0)
    st = stems(form, pos)
    if st:
        f = max(f, sum(freq.get(t, 0.0) for t in set(st)))
    return f

POS_MAP = [('adj-i', 'i-adj'), ('adj-na', 'na-adj'), ('adj', 'adj'), ('adv', 'adverb'),
           ('n', 'noun'), ('ctr', 'counter'), ('suf', 'suffix'), ('pref', 'prefix'),
           ('num', 'number'), ('pn', 'pronoun'), ('exp', 'expression'),
           ('int', 'interjection'), ('conj', 'conjunction')]

def pos_label(pos):
    for p in pos:
        if re.match(r'^v(1|5|k|z|s-i|s-s|r|n|2|4)', p):
            return 'verb'
        for pre, lab in POS_MAP:
            if p == pre or p.startswith(pre + '-'):
                return lab
    return ''

d = json.load(open(SRC, encoding='utf-8'))
rows = []
seen = set()

def emit(w, senses, pos, form, common, score):
    cands = [r for r in w['kana'] if not (BAD_KANA_TAGS & set(r['tags']))
             and ('*' in r['appliesToKanji'] or form in r['appliesToKanji'])]
    if not cands:
        return
    cands.sort(key=lambda r: not r['common'])
    reading = cands[0]['text']
    if (form, reading) in seen:
        return
    glosses = []
    for s in senses:
        if s['appliesToKanji'] != ['*'] and form not in s['appliesToKanji']:
            continue
        if s['appliesToKana'] != ['*'] and reading not in s['appliesToKana']:
            continue
        g = '; '.join(x['text'] for x in s['gloss'][:3])
        if g:
            glosses.append(g)
        if len(glosses) == 3:
            break
    if not glosses:
        return
    gloss = ' | '.join(glosses)
    if len(gloss) > 140:
        gloss = gloss[:137].rsplit(' ', 1)[0] + '…'
    uk = 'uk' in senses[0]['misc']
    seen.add((form, reading))
    rows.append([form, reading, gloss, pos_label(pos), score, (1 if common else 0) | (2 if uk else 0)])

for w in d['words']:
    senses = [s for s in w['sense'] if not (set(s['misc']) & SKIP_MISC)]
    kforms = [k for k in w['kanji'] if not (set(k['tags']) & BAD_KANJI_TAGS)
              and KANJI_RE.search(k['text']) and not ODD_RE.search(k['text'])]
    if not senses or not kforms:
        continue
    pos = senses[0]['partOfSpeech']
    common = any(k['common'] for k in w['kanji']) or any(r['common'] for r in w['kana'])
    ef = max(word_freq(k['text'], pos) for k in kforms)
    zipf = math.log10(ef * 1e9) if ef > 0 else 0.0
    if not common and zipf < 2.3:
        continue
    # compounds MeCab splits have no frequency of their own; give common ones a floor
    if common and zipf < 3.0:
        zipf = 3.0
    score = round(zipf * 10)
    forms = [k for k in kforms if k['common']] or kforms[:1]
    for k in forms:
        emit(w, senses, pos, k['text'], common, score)

# Same spelling, several readings: keep only the common readings when any exist
by_form = defaultdict(list)
for r in rows:
    by_form[r[0]].append(r)
keep = []
for form, rs in by_form.items():
    if any(r[5] & 1 for r in rs):
        rs = [r for r in rs if r[5] & 1]
    keep.extend(rs)
rows = sorted(keep, key=lambda r: (-r[4], -(r[5] & 1), len(r[0])))

meta = {'jmdict': d['dictDate'], 'count': len(rows)}
with open(OUT, 'w', encoding='utf-8') as fh:
    fh.write('/* Vocabulary: JMdict (EDRDG, CC BY-SA 4.0) via jmdict-simplified. Frequency: wordfreq (CC BY-SA 4.0). */\n')
    fh.write('window.VOCAB_META=' + json.dumps(meta) + ';\n')
    fh.write('window.VOCAB=' + json.dumps(rows, ensure_ascii=False, separators=(',', ':')) + ';\n')
print(meta)
