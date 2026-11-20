# Yomeru 読める

Find Japanese words made only from the kanji you already know — from WaniKani, a JLPT level, a school grade, or your own list.

**Live site:** https://yomeru-vocab.pages.dev · **Support:** https://ko-fi.com/yomeru

## Layout

- `site/` — the website (static: `index.html`, `words.js`, `kanji.js`). Every push to `main` that changes it is deployed automatically to Cloudflare Pages by `.github/workflows/deploy.yml`.
- `build/` — scripts that generate the data files:
  - `build_data.py` → `site/words.js` (needs Python, `wordfreq`, and the `jmdict-eng` JSON from [jmdict-simplified](https://github.com/scriptin/jmdict-simplified))
  - `build_kanji.py` → `site/kanji.js` (needs `kanji.json` from [kanji-data](https://github.com/davidluzgouveia/kanji-data))

## Credits

- Dictionary: [JMdict](https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project) and [KANJIDIC](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project) by the Electronic Dictionary Research and Development Group, CC BY-SA 4.0
- Word frequency: [wordfreq](https://github.com/rspeer/wordfreq), CC BY-SA 4.0
- JLPT kanji levels: Jonathan Waller's lists, via kanji-data

The generated data files in `site/` are shared under CC BY-SA 4.0. Not affiliated with WaniKani, Tofugu or the JLPT.
