/* Yomeru export: Anki deck (.apkg), Anki text file, Quizlet/other apps, CSV.
   The .apkg writer follows genanki's format (schema 11), built in the browser with sql.js + JSZip. */
(() => {
  const Y = window.Yomeru;
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- helpers ---------- */
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }
  function loadScript(src) {
    return new Promise((ok, fail) => {
      if (document.querySelector(`script[data-src="${src}"]`)) return ok();
      const s = document.createElement('script');
      s.src = src; s.dataset.src = src; s.onload = ok;
      s.onerror = () => fail(new Error('Could not load ' + src));
      document.head.append(s);
    });
  }
  // 64-bit FNV-1a → stable ids/guids without needing a secure context
  function fnv64(str) {
    let h = 0xcbf29ce484222325n;
    for (const b of new TextEncoder().encode(str)) { h ^= BigInt(b); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; }
    return h;
  }
  const B91 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~';
  function guidFor(str) {
    let n = fnv64(str), out = '';
    do { out = B91[Number(n % 91n)] + out; n /= 91n; } while (n > 0n);
    return out;
  }
  const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  /* ---------- word → note fields ---------- */
  function fields(w, calc) {
    const meanings = w.g.split(' | ');
    const kanji = w.ks.map(c => {
      const m = calc.mean(c) || '', t = calc.tag(c) || '';
      return `<span class="k">${esc(c)}</span> ${esc(m)}${t ? ` <span class="t">(${esc(t)})</span>` : ''}`;
    }).join('<br>');
    const level = calc.label(w.lv).replace(/^New (at|in) /, '');
    return {
      word: w.k, reading: w.r,
      meaningHtml: meanings.length > 1 ? meanings.map((m, i) => `${i + 1}. ${esc(m)}`).join('<br>') : esc(meanings[0]),
      meaningText: meanings.join('; '),
      kanjiHtml: kanji, type: w.p || '', level,
    };
  }

  /* ---------- Anki deck (.apkg) ---------- */
  const CSS = `.card{font-family:"Hiragino Sans","Yu Gothic","Noto Sans JP",system-ui,sans-serif;font-size:20px;text-align:center;line-height:1.5}
.jp{font-family:"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif}
.word{font-size:60px;line-height:1.2;margin:.2em 0}
.reading{font-size:28px;margin:.2em 0}
.meaning{font-size:22px;margin:.6em auto;max-width:34em}
.kanji{font-size:16px;margin:1em auto 0;display:inline-block;text-align:left;opacity:.85}
.kanji .k{font-family:"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif;font-size:22px}
.kanji .t,.meta{font-size:13px;opacity:.65}
.meta{margin-top:1em}`;
  const RECOG_Q = '<div class="jp word">{{Word}}</div>';
  const RECOG_A = '{{FrontSide}}<hr id="answer"><div class="jp reading">{{Reading}}</div><div class="meaning">{{Meaning}}</div><div class="kanji">{{Kanji}}</div><div class="meta">{{Type}}{{#Level}} · {{Level}}{{/Level}} · Yomeru</div>';
  // The reverse card only exists when the note's Reverse field is filled, so one note type covers both choices
  const RECALL_Q = '{{#Reverse}}<div class="meaning">{{Meaning}}</div><div class="meta">{{Type}}</div>{{/Reverse}}';
  const RECALL_A = '{{FrontSide}}<hr id="answer"><div class="jp word">{{Word}}</div><div class="jp reading">{{Reading}}</div><div class="kanji">{{Kanji}}</div>';
  const FIELD_NAMES = ['Word', 'Reading', 'Meaning', 'Kanji', 'Type', 'Level', 'Reverse'];
  const MODEL_ID = 1763500000003;

  function modelJson(id, name, deckId, now) {
    const tmpls = [{ name: 'Japanese → English', qfmt: RECOG_Q, afmt: RECOG_A }, { name: 'English → Japanese', qfmt: RECALL_Q, afmt: RECALL_A }];
    return {
      css: CSS, did: deckId, id: String(id), name, type: 0, mod: now, usn: -1, sortf: 0, tags: [], vers: [],
      latexPre: '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
      latexPost: '\\end{document}', latexsvg: false,
      req: [[0, 'all', [0]], [1, 'all', [6]]],
      flds: FIELD_NAMES.map((n, ord) => ({ name: n, ord, font: 'Arial', media: [], rtl: false, size: 20, sticky: false })),
      tmpls: tmpls.map((t, ord) => ({ name: t.name, ord, qfmt: t.qfmt, afmt: t.afmt, bafmt: '', bqfmt: '', bfont: '', bsize: 0, did: null })),
    };
  }

  async function buildApkg(words, calc, deckName, both, tagBase) {
    await loadScript('vendor/anki-sql.js');
    await loadScript('vendor/sql-wasm.js');
    await loadScript('vendor/jszip.min.js');
    const SQL = await window.initSqlJs({ locateFile: f => 'vendor/' + f });
    const db = new SQL.Database();
    db.exec(window.ANKI_SQL.schema);
    db.exec(window.ANKI_SQL.col);

    const now = Math.floor(Date.now() / 1000);
    const deckId = Number(fnv64('yomeru-deck|' + deckName) % 9000000000000n) + 1000000000000;
    const modelId = MODEL_ID, modelName = 'Yomeru Vocab';

    const decks = JSON.parse(db.exec('SELECT decks FROM col')[0].values[0][0]);
    decks[String(deckId)] = {
      collapsed: false, conf: 1, desc: 'Words you can already read, made with Yomeru · https://yomeru-vocab.pages.dev',
      dyn: 0, extendNew: 0, extendRev: 50, id: deckId, lrnToday: [0, 0], mod: now, name: deckName,
      newToday: [0, 0], revToday: [0, 0], timeToday: [0, 0], usn: -1,
    };
    const models = { [String(modelId)]: modelJson(modelId, modelName, deckId, now) };
    db.run('UPDATE col SET decks = ?, models = ?', [JSON.stringify(decks), JSON.stringify(models)]);

    let id = Date.now();
    const insNote = db.prepare('INSERT INTO notes VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    const insCard = db.prepare('INSERT INTO cards VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    words.forEach((w, i) => {
      const f = fields(w, calc);
      const flds = [f.word, f.reading, f.meaningHtml, f.kanjiHtml, f.type, f.level, both ? 'y' : ''].join('\x1f');
      const tags = ` yomeru ${tagBase}${f.level ? ' ' + tagBase + '::' + slug(f.level) : ''}${f.type ? ' yomeru::' + slug(f.type) : ''} `;
      const nid = id++;
      insNote.run([nid, guidFor('yomeru|' + w.k + '|' + w.r), modelId, now, -1, tags, flds, f.word, 0, 0, '']);
      insCard.run([id++, nid, deckId, 0, now, -1, 0, 0, i + 1, 0, 0, 0, 0, 0, 0, 0, 0, '']);
      if (both) insCard.run([id++, nid, deckId, 1, now, -1, 0, 0, i + 1, 0, 0, 0, 0, 0, 0, 0, 0, '']);
    });
    insNote.free(); insCard.free();
    const bytes = db.export();
    db.close();

    const zip = new window.JSZip();
    zip.file('collection.anki2', bytes);
    zip.file('media', '{}');
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  }

  /* ---------- text formats ---------- */
  function ankiText(words, calc, deckName, tagBase) {
    const clean = s => String(s).replace(/[\t\r\n]+/g, ' ');
    const lines = ['#separator:tab', '#html:true', '#notetype:Basic', '#deck:' + deckName, '#tags column:3'];
    for (const w of words) {
      const f = fields(w, calc);
      const back = `<div style="font-size:1.4em">${esc(f.reading)}</div>${f.meaningHtml}<br><br><small>${f.kanjiHtml}</small>`;
      lines.push([clean(f.word), clean(back), `yomeru ${tagBase}${f.level ? ' ' + tagBase + '::' + slug(f.level) : ''}`].join('\t'));
    }
    return lines.join('\n') + '\n';
  }
  function quizletText(words, calc) {
    return words.map(w => {
      const f = fields(w, calc);
      return `${f.word} (${f.reading})\t${f.meaningText.replace(/[\t\n]+/g, ' ')}`;
    }).join('\n');
  }
  function csvText(words, calc) {
    const rows = [['Word', 'Reading', 'Meaning', 'Type', 'Unlocked at']].concat(words.map(w => {
      const f = fields(w, calc); return [f.word, f.reading, f.meaningText, f.type, f.level];
    }));
    return '\ufeff' + rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
  }

  /* ---------- dialog ---------- */
  const dlg = $('#exportDlg');
  const fmtRadios = () => [...dlg.querySelectorAll('input[name=xfmt]')];
  const fmt = () => (fmtRadios().find(r => r.checked) || {}).value || 'apkg';

  function refresh() {
    const words = Y.words();
    const f = fmt();
    $('#xCount').textContent = words.length.toLocaleString();
    dlg.querySelectorAll('[data-for]').forEach(el => { el.hidden = !el.dataset.for.split(' ').includes(f); });
    $('#xGo').textContent = { apkg: 'Download Anki deck', ankitxt: 'Download text file', quizlet: 'Copy to clipboard', csv: 'Download CSV' }[f];
    $('#xGo').disabled = !words.length;
    if (f === 'quizlet') $('#xPreview').value = quizletText(words.slice(0, 2000), Y.calc());
    $('#xStatus').textContent = '';
  }

  function open() {
    if (!$('#xDeck').value) $('#xDeck').value = 'Yomeru::' + Y.sourceLabel();
    try { const p = JSON.parse(localStorage.getItem('yomeru.export') || '{}'); if (p.fmt) fmtRadios().forEach(r => r.checked = r.value === p.fmt); if (p.both != null) $('#xBoth').checked = p.both; } catch {}
    refresh();
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }

  async function go() {
    const words = Y.words(), calc = Y.calc(), f = fmt();
    const deckName = ($('#xDeck').value || 'Yomeru').trim().replace(/\s*::\s*/g, '::');
    const tagBase = 'yomeru::' + slug(Y.sourceLabel());
    const stamp = new Date().toISOString().slice(0, 10);
    const base = 'yomeru-' + slug(Y.sourceLabel()) + '-' + stamp;
    try { localStorage.setItem('yomeru.export', JSON.stringify({ fmt: f, both: $('#xBoth').checked })); } catch {}
    $('#xGo').disabled = true;
    try {
      if (f === 'apkg') {
        $('#xStatus').textContent = 'Building your deck…';
        download(await buildApkg(words, calc, deckName, $('#xBoth').checked, tagBase), base + '.apkg');
        $('#xStatus').textContent = `Done: ${words.length.toLocaleString()} words. Open the file to import it into Anki.`;
      } else if (f === 'ankitxt') {
        download(new Blob([ankiText(words, calc, deckName, tagBase)], { type: 'text/plain;charset=utf-8' }), base + '.txt');
        $('#xStatus').textContent = 'Done. In Anki: File › Import, then pick this file.';
      } else if (f === 'quizlet') {
        const txt = quizletText(words, calc);
        try { await navigator.clipboard.writeText(txt); $('#xStatus').textContent = 'Copied! In Quizlet: Create › Import, then paste.'; }
        catch { $('#xPreview').select(); $('#xStatus').textContent = 'Press Ctrl+C (or ⌘C) to copy the selected text.'; }
      } else {
        download(new Blob([csvText(words, calc)], { type: 'text/csv;charset=utf-8' }), base + '.csv');
        $('#xStatus').textContent = 'Done.';
      }
      if ($('#xMark').checked) Y.markKnown(words);
    } catch (e) {
      $('#xStatus').textContent = 'Something went wrong: ' + e.message;
    } finally {
      $('#xGo').disabled = false;
    }
  }

  fmtRadios().forEach(r => r.addEventListener('change', refresh));
  $('#xGo').addEventListener('click', go);
  $('#xClose').addEventListener('click', () => dlg.close ? dlg.close() : dlg.removeAttribute('open'));
  dlg.addEventListener('click', e => { if (e.target === dlg && dlg.close) dlg.close(); });
  $('#exportBtn').addEventListener('click', open);

  // exposed for tests
  window.YomeruExport = { buildApkg, ankiText, quizletText, csvText, guidFor };
})();
