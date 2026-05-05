#!/usr/bin/env node
'use strict';

const axios    = require('axios');
const cheerio  = require('cheerio');
const fs       = require('fs');
const path     = require('path');
const readline = require('readline');

// ================================================================
//   OTAKUDESU Batch Scraper CLI v5.1
//   - Fix: Parser info field yang tadinya gabung jadi satu
//   - Thumbnail: selector akurat .imganime img.wp-post-image
//   - Ambil semua field: judul, japanese, type, episode, rating,
//     genre, duration, studios, producers, aired, credit, sinopsis
//   - Download link dengan resolusi dan size
// ================================================================

const CFG = {
  storageDir:  '/storage/emulated/0/OtakuDesu',
  fallbackDir: path.join(process.env.HOME || '.', 'OtakuDesu'),
  timeout:     25000,
  ua: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
};

const C = {
  r: '\x1b[0m',   b: '\x1b[1m',   d: '\x1b[2m',
  red: '\x1b[31m', grn: '\x1b[32m', yel: '\x1b[33m',
  blu: '\x1b[34m', mag: '\x1b[35m', cyn: '\x1b[36m',
  wht: '\x1b[37m',
};

const x = {
  h:  s => `${C.b}${C.cyn}${s}${C.r}`,
  lb: s => `${C.b}${C.yel}${s}${C.r}`,
  v:  s => `${C.wht}${s}${C.r}`,
  ok: s => `${C.b}${C.grn}  ✓  ${s}${C.r}`,
  er: s => `${C.b}${C.red}  ✗  ${s}${C.r}`,
  wn: s => `${C.yel}  ⚠  ${s}${C.r}`,
  ii: s => `${C.cyn}  →  ${s}${C.r}`,
  dm: s => `${C.d}${s}${C.r}`,
  mg: s => `${C.b}${C.mag}${s}${C.r}`,
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const sep   = (ch='─', n=62, col=C.d) => console.log(`${col}${ch.repeat(n)}${C.r}`);
const safe  = (s, n=60) => (s||'').replace(/[^a-zA-Z0-9\-_]/g,'_').replace(/_+/g,'_').slice(0,n);

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); return true; }
  catch (e) { return false; }
}

function resolveStorageDir() {
  if (ensureDir(CFG.storageDir)) return CFG.storageDir;
  console.log(x.wn(`/storage/emulated/0 tidak tersedia, pakai: ${CFG.fallbackDir}`));
  ensureDir(CFG.fallbackDir);
  return CFG.fallbackDir;
}

function spinner(label) {
  const fr = ['⣾','⣽','⣻','⢿','⡿','⣟','⣯','⣷'];
  let i = 0;
  const iv = setInterval(() =>
    process.stdout.write(`\r  ${C.cyn}${fr[i++%fr.length]}${C.r}  ${label}  `), 90);
  const clear = () => {
    clearInterval(iv);
    process.stdout.write('\r' + ' '.repeat(label.length + 16) + '\r');
  };
  return {
    ok:  msg => { clear(); console.log(x.ok(msg)); },
    err: msg => { clear(); console.log(x.er(msg)); },
  };
}

function banner() {
  console.clear();
  console.log(`\n${C.b}${C.cyn}`);
  console.log('  ╔══════════════════════════════════════════════════════════╗');
  console.log('  ║                                                          ║');
  console.log('  ║   ░█▀▀█ ▀▀█▀▀ ─█▀▀█ █─█ █──█ ░█▀▀▄ █▀▀ █▀▀ █─█        ║');
  console.log('  ║   ░█──█ ──█── ░█▄▄█ █▀▄ █──█ ░█─░█ █▀▀ ▀▀█ █─█        ║');
  console.log('  ║   ░█▄▄█ ──▀── ░█─░█ ▀─▀ ─▀▀▀ ░█▄▄▀ ▀▀▀ ▀▀▀ ─▀─        ║');
  console.log('  ║                                                          ║');
  console.log('  ║    Batch Scraper CLI  ─  v5.1  🎌  Termux Edition        ║');
  console.log('  ║    Parser Fix: Info Fields Terpisah Rapi                 ║');
  console.log('  ║                                                          ║');
  console.log('  ╚══════════════════════════════════════════════════════════╝');
  console.log(C.r);
}

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin, output: process.stdout, terminal: true,
  });
  return new Promise(resolve =>
    rl.question(question, ans => { rl.close(); resolve(ans.trim()); })
  );
}

async function askUrl() {
  while (true) {
    sep('─', 62, C.mag);
    console.log(`  ${x.mg('📌 Masukkan URL batch Otakudesu')}`);
    console.log(x.dm('  Contoh: https://otakudesu.blog/batch/spy-x-family-batch-sub-indo/'));
    sep('─', 62, C.d);

    const raw = await prompt(`\n  ${C.b}${C.yel}URL » ${C.r}`);
    console.log('');

    if (!raw) { console.log(x.wn('URL tidak boleh kosong!\n')); continue; }
    if (!raw.startsWith('http')) { console.log(x.er('URL harus diawali http:// atau https://\n')); continue; }
    if (!raw.includes('otakudesu')) {
      const ok = await prompt(`  ${C.yel}⚠  URL bukan dari otakudesu, tetap lanjut? [y/N] ${C.r}`);
      console.log('');
      if (!ok.toLowerCase().startsWith('y')) continue;
    }
    return raw;
  }
}

async function askLagi() {
  const ans = await prompt(`  ${C.b}${C.cyn}Scrape URL lain? [y/N] ${C.r}`);
  return ans.toLowerCase().startsWith('y');
}

async function fetchHtml(url) {
  const { data } = await axios.get(url, {
    headers: {
      'User-Agent':      CFG.ua,
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'id-ID,id;q=0.9,en;q=0.7',
      'Referer':         'https://otakudesu.blog/',
    },
    timeout: CFG.timeout,
  });
  return data;
}

// ──────────────────────────────────────────────
// PARSER OTAKUDESU v5.1 — Fix Info Fields
// Struktur HTML otakudesu:
//   .infos berisi: <b>Key</b>: Value<br /><b>Key2</b>: Value2<br />...
//   Harus split by <br /> lalu parse tiap key-value pair
// ──────────────────────────────────────────────
function parse($, url) {
  // ── Judul ──────────────────────────────────
  const judul =
    $('.jdlrx h1').text().trim() ||
    $('.venser h1').first().text().trim() ||
    $('h1.entry-title').text().trim() ||
    $('h1').first().text().trim() ||
    'Tidak ditemukan';

  // ── Thumbnail ──────────────────────────────
  let thumb = null;
  const thumbSelectors = [
    '.imganime img.wp-post-image',
    '.imganime img',
    'img.attachment-post-thumbnail',
    'img.wp-post-image',
    '.fotoanime img',
    '.thumb img',
    '.anime-thumb img',
    '.cover img',
    '.gambar img',
    '.dtlimgcon img',
  ];
  for (const sel of thumbSelectors) {
    const img = $(sel).first();
    const src = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src');
    if (src) { thumb = src; break; }
  }
  if (!thumb) {
    $('img').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src') || '';
      if (/cover|poster|thumb|anime/i.test(src) && /\.(jpe?g|png|webp)/i.test(src)) {
        thumb = src; return false;
      }
    });
  }

  // ── Info Fields ────────────────────────────
  // FIX: .infos berisi SEMUA field dalam satu div, dipisah <br />
  const info = {};

  // Fungsi parse satu key-value pair
  const parsePair = (html) => {
    // Cari <b>Key</b>
    const bMatch = html.match(/<b>(.*?)<\/b>/i);
    if (!bMatch) return;
    const key = bMatch[1].trim().replace(/[:：]/g, '').toLowerCase();
    // Value = sisanya setelah </b>, hapus : di awal
    let val = html.replace(/<b>.*?<\/b>/i, '').trim();
    val = val.replace(/^[\s:：]+/, '').trim();
    // Strip semua tag HTML sisanya
    val = val.replace(/<[^>]+>/g, '').trim();
    if (key && val && !info[key]) {
      info[key] = val;
    }
  };

  // Coba .infos dulu (struktur utama otakudesu)
  const infosEl = $('.infos');
  if (infosEl.length > 0) {
    // Ambil HTML inner, split by <br />
    const html = infosEl.html() || '';
    const parts = html.split(/<br\s*\/?>/i);
    parts.forEach(part => {
      if (part.trim()) parsePair(part);
    });
  }

  // Fallback: selector lama
  if (Object.keys(info).length < 3) {
    const infoContainers = [
      '.infozingle p', '.infoanime p', '.infov1 p',
      '.info-anime p', '.anime-info p', '.detail-anime p',
    ];
    for (const sel of infoContainers) {
      $(sel).each((_, el) => {
        const $el = $(el);
        const bTag = $el.find('b').first().text().trim().replace(/[:：]/g, '').toLowerCase();
        const clone = $el.clone();
        clone.find('b').remove();
        clone.find('a').each(function() { $(this).replaceWith($(this).text()); });
        let val = clone.text().replace(/^[\s:：]+/, '').trim();
        if (bTag && val && !info[bTag]) info[bTag] = val;
      });
    }
  }

  // ── Helper ambil field ──
  const g = (...keys) => {
    for (const k of keys) {
      if (info[k]) return info[k];
      const found = Object.entries(info).find(([ik]) => ik.includes(k) || k.includes(ik));
      if (found) return found[1];
    }
    return null;
  };

  // ── Sinopsis ───────────────────────────────
  let synopsis = null;
  const synSelectors = ['.deskripsi', '.sinopc', '.sinopsis', '.synopsis'];
  for (const sel of synSelectors) {
    const $el = $(sel);
    if ($el.length === 0) continue;
    let t = $el.text().trim().replace(/\s+/g, ' ');
    t = t.replace(/^Sinopsis:\s*/i, '');
    if (t.length > 20) { synopsis = t.slice(0, 2000); break; }
  }

  // ── Download Links ─────────────────────────
  const dlLinks = [];
  const seenHref = new Set();

  // Primary: .download2 .batchlink
  $('.download2 .batchlink ul li, .download ul li, .batchlink ul li').each((_, el) => {
    const $li = $(el);
    const resolution = $li.find('strong').first().text().trim();
    const size = $li.find('i').first().text().trim();
    $li.find('a[href]').each((_, aEl) => {
      const $a = $(aEl);
      const href = $a.attr('href') || '';
      const label = $a.text().trim() || '';
      if (!href.startsWith('http') || seenHref.has(href)) return;
      seenHref.add(href);
      dlLinks.push({ label, resolution, size, url: href, host: (() => { try { return new URL(href).hostname; } catch { return '?'; } })() });
    });
  });

  // Fallback
  if (dlLinks.length === 0) {
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const label = $(el).text().trim() || '';
      if (!href.startsWith('http') || seenHref.has(href)) return;
      const isDownload = /\.(mkv|mp4|avi|zip|rar|7z)(\?|$)/i.test(href) ||
        /mega\.nz|mediafire|gdrive|drive\.google|zippyshare|pixeldrain|krakenfiles|racaty|acefile|letsupload|solidfiles|upstream|streamlare|gofile|1fichier/i.test(href) ||
        /batch|episode|eps|ep\d/i.test(label);
      if (isDownload) {
        seenHref.add(href);
        dlLinks.push({ label, resolution: '', size: '', url: href, host: (() => { try { return new URL(href).hostname; } catch { return '?'; } })() });
      }
    });
  }

  // ── Resolusi ──
  const resolutions = [];
  $('[class*="resolution"],[class*="quality"],[class*="reso"]').each((_, el) => {
    const t = $(el).text().trim();
    if (t) resolutions.push(t);
  });
  if (!resolutions.length) {
    const resPat = /\b(2160|1080|720|480|360|240)p\b/gi;
    $('td, th, span, b, strong').each((_, el) => {
      const t = $(el).text();
      const m = t.match(resPat);
      if (m) m.forEach(r => { if (!resolutions.includes(r)) resolutions.push(r); });
    });
  }

  // ── Episode ──
  let totalEp = g('episodes', 'episode', 'total episode', 'jumlah episode', 'eps');
  if (!totalEp) {
    const badge = $('.epbadge,.total-eps,.episode-count,.jumlah-episode,.totalepisode .total').text().trim();
    if (badge) totalEp = badge;
  }

  // ── Rating ──
  let rating = g('rating', 'score', 'skor', 'mal score', 'myanimelist');
  if (!rating) {
    $('[class*="score"],[class*="rating"],[class*="mal"]').each((_, el) => {
      const t = $(el).text().trim();
      if (/^\d[\d.]+$/.test(t) && parseFloat(t) <= 10) { rating = t; return false; }
    });
  }

  // ── Genre ──
  let genre = g('genre', 'genres', 'kategori', 'category');
  if (!genre) {
    const genreLinks = [];
    $('a[href*="/genre/"], a[href*="/genres/"]').each((_, el) => {
      const t = $(el).text().trim();
      if (t && !genreLinks.includes(t)) genreLinks.push(t);
    });
    if (genreLinks.length) genre = genreLinks.join(', ');
  }

  return {
    judul,
    japanese: g('japanese', 'judul jepang', 'judul alternatif', 'alternative', 'jp'),
    status: g('status'),
    type: g('type', 'tipe', 'jenis'),
    episode: totalEp,
    duration: g('duration', 'durasi', 'durasi per episode', 'durasi/episode'),
    rating,
    genre,
    studios: g('studios', 'studio', 'production studio', 'production'),
    producers: g('producers', 'producer', 'produser'),
    aired: g('aired', 'tayang', 'tanggal tayang', 'broadcast', 'season', 'rilis'),
    credit: g('credit', 'credits', 'subtitle', 'subtitle by', 'penerjemah', 'translator', 'fansub'),
    thumbnail: thumb,
    synopsis,
    resolutions: resolutions.length ? [...new Set(resolutions)] : null,
    downloadLinks: dlLinks,
    totalDownloadLinks: dlLinks.length,
    _scrapedAt: new Date().toISOString(),
    _sourceUrl: url,
    _rawInfoMap: info,
  };
}

// ──────────────────────────────────────────────
// DOWNLOAD THUMBNAIL
// ──────────────────────────────────────────────
async function downloadThumb(url, outPath) {
  const sp = spinner('Mengunduh thumbnail');
  try {
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: { 'User-Agent': CFG.ua },
      timeout: CFG.timeout,
    });
    fs.writeFileSync(outPath, res.data);
    sp.ok(`Thumbnail → ${path.basename(outPath)}  (${(res.data.length/1024).toFixed(1)} KB)`);
    return true;
  } catch (e) {
    sp.err(`Thumbnail gagal: ${e.message}`);
    return false;
  }
}

// ──────────────────────────────────────────────
// SIMPAN JSON
// ──────────────────────────────────────────────
function saveJson(data, outPath) {
  try {
    const { _rawInfoMap, ...clean } = data;
    fs.writeFileSync(outPath, JSON.stringify(clean, null, 2), 'utf-8');
    console.log(x.ok(`JSON     → ${path.basename(outPath)}`));
    return true;
  } catch (e) {
    console.log(x.er(`JSON gagal: ${e.message}`)); return false;
  }
}

// ──────────────────────────────────────────────
// SIMPAN MARKDOWN
// ──────────────────────────────────────────────
function saveMarkdown(data, outPath) {
  try {
    const f = (k, v) => `| ${k} | ${v || '—'} |`;
    const dl = data.downloadLinks.length
      ? data.downloadLinks.map(l => `- [${l.label}${l.resolution ? ' (' + l.resolution + ')' : ''}${l.size ? ' ' + l.size : ''}](${l.url})  \`${l.host}\``).join('\n')
      : '_Tidak ditemukan_';

    const md = [
      `# ${data.judul}`,
      ``,
      `> 🔗 Sumber: ${data._sourceUrl}`,
      `> 🕐 Diambil: ${new Date(data._scrapedAt).toLocaleString('id-ID')}`,
      ``,
      data.thumbnail ? `![Cover](${data.thumbnail})\n` : '',
      `## 📋 Informasi`,
      ``,
      `| Field | Nilai |`,
      `|:------|:------|`,
      f('🇯🇵 Japanese',  data.japanese),
      f('📊 Status',     data.status),
      f('🎭 Type',       data.type),
      f('📺 Episode',    data.episode),
      f('⏱️ Duration',   data.duration),
      f('⭐ Rating',     data.rating),
      f('🏷️ Genre',      data.genre),
      f('🎨 Studios',    data.studios),
      f('🏢 Producers',  data.producers),
      f('📅 Aired',      data.aired),
      f('👤 Credit',     data.credit),
      data.resolutions ? f('📐 Resolusi', data.resolutions.join(', ')) : '',
      ``,
      `## 📝 Sinopsis`,
      ``,
      data.synopsis || '_Tidak ditemukan_',
      ``,
      `## 📥 Link Download (${data.totalDownloadLinks} link)`,
      ``,
      dl,
    ].filter(l => l !== null && l !== undefined).join('\n');

    fs.writeFileSync(outPath, md, 'utf-8');
    console.log(x.ok(`Markdown → ${path.basename(outPath)}`));
    return true;
  } catch (e) {
    console.log(x.er(`Markdown gagal: ${e.message}`)); return false;
  }
}

// ──────────────────────────────────────────────
// TAMPILKAN HASIL DI TERMINAL
// ──────────────────────────────────────────────
function printResult(data, outDir) {
  const show = (icon, lbl, val) => {
    const pad = `${icon} ${lbl}`.padEnd(18);
    const txt = val ? x.v(val) : x.dm('—');
    console.log(`  ${x.lb(pad)} : ${txt}`);
  };

  console.log('');
  console.log(x.h('  ╔═══════════════════════════════════════════════════════╗'));
  console.log(x.h('  ║  📋  HASIL SCRAPING                                   ║'));
  console.log(x.h('  ╚═══════════════════════════════════════════════════════╝'));
  console.log('');

  show('🎬','Judul',       data.judul);
  show('🇯🇵','Japanese',    data.japanese);
  show('📊','Status',      data.status);
  show('🎭','Type',        data.type);
  show('📺','Episode',     data.episode);
  show('⏱️','Duration',    data.duration);
  show('⭐','Rating',      data.rating);
  show('🏷️','Genre',       data.genre);
  show('🎨','Studios',     data.studios);
  show('🏢','Producers',   data.producers);
  show('📅','Aired',       data.aired);
  show('👤','Credit',      data.credit);
  if (data.resolutions) show('📐','Resolusi', data.resolutions.join(', '));
  show('🖼️','Thumbnail',  data.thumbnail ? '✓ ditemukan' : null);

  // Sinopsis
  if (data.synopsis) {
    console.log(`\n  ${x.lb('📝 Sinopsis:')}`);
    const words = data.synopsis.split(' ');
    let line = '     ';
    words.forEach(w => {
      if ((line + w).length > 72) { console.log(x.dm(line)); line = '     '; }
      line += w + ' ';
    });
    if (line.trim()) console.log(x.dm(line.trim()));
  } else {
    console.log(`\n  ${x.wn('Sinopsis tidak ditemukan')}`);
  }

  // Download links
  console.log(`\n  ${x.lb('📥 Download Links:')} ${x.dm(`${data.downloadLinks.length} link ditemukan`)}`);
  if (data.downloadLinks.length === 0) {
    console.log(x.wn('     Tidak ada link download terdeteksi'));
  } else {
    data.downloadLinks.slice(0, 8).forEach(l => {
      const reso = l.resolution ? ` ${l.resolution}` : '';
      const size = l.size ? ` ${l.size}` : '';
      console.log(`     ${C.cyn}›${C.r} ${l.label}${reso}${size}`);
      console.log(`       ${C.d}[${l.host}]  ${l.url.slice(0,70)}${l.url.length>70?'…':''}${C.r}`);
    });
    if (data.downloadLinks.length > 8)
      console.log(x.dm(`     … +${data.downloadLinks.length - 8} link lainnya (lihat file JSON/MD)`));
  }

  // Raw info map debug
  const rawEntries = Object.entries(data._rawInfoMap);
  if (rawEntries.length) {
    console.log(`\n  ${x.dm(`── Raw fields terdeteksi (${rawEntries.length}) ──`)}`);
    rawEntries.forEach(([k,v]) =>
      console.log(`  ${C.d}${k.padEnd(30)}${C.r}: ${C.wht}${String(v).slice(0,65)}${C.r}`)
    );
  }

  console.log(`\n  ${x.lb('📁 Output:')} ${C.cyn}${outDir}${C.r}\n`);
}

// ──────────────────────────────────────────────
// PROSES SATU URL
// ──────────────────────────────────────────────
async function processUrl(url, storageDir) {
  sep('═', 62, C.cyn);
  console.log(x.ii(`Target: ${url}`));
  sep('─', 62, C.d);

  const t0  = Date.now();
  const fsp = spinner('Mengambil halaman');
  let html;
  try {
    html = await fetchHtml(url);
    fsp.ok(`Halaman diambil  ${Date.now()-t0}ms  (${(html.length/1024).toFixed(1)} KB)`);
  } catch (e) {
    fsp.err(`Gagal mengambil halaman: ${e.message}`);
    if (e.response) console.log(x.wn(`HTTP ${e.response.status}`));
    return false;
  }

  const psp = spinner('Mem-parsing semua data');
  await sleep(150);
  const $    = cheerio.load(html);
  const data = parse($, url);
  psp.ok(`Parsing selesai — ${Object.keys(data._rawInfoMap).length} field ditemukan`);

  const folderName = safe(data.judul) || `anime_${Date.now()}`;
  const outDir     = path.join(storageDir, folderName);
  ensureDir(outDir);

  printResult(data, outDir);

  sep('─', 62, C.mag);
  console.log(`  ${x.mg('💾 MENYIMPAN FILE')}\n`);

  saveJson(    data, path.join(outDir, `${folderName}.json`));
  saveMarkdown(data, path.join(outDir, `${folderName}.md`));

  if (data.thumbnail) {
    const raw = data.thumbnail.split('?')[0];
    const ext = /\.png$/i.test(raw) ? 'png' : /\.webp$/i.test(raw) ? 'webp' : 'jpg';
    await downloadThumb(data.thumbnail, path.join(outDir, `cover.${ext}`));
  } else {
    console.log(x.wn('Thumbnail tidak ditemukan'));
  }

  sep('═', 62, C.grn);
  console.log(x.ok(`Selesai! File disimpan di:\n     ${C.b}${outDir}${C.r}`));
  console.log('');
  return true;
}

// ──────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────
async function main() {
  banner();
  const storageDir = resolveStorageDir();
  console.log(x.ii(`Storage utama : ${storageDir}\n`));

  const cliUrl = process.argv[2];
  if (cliUrl) {
    if (!cliUrl.startsWith('http')) { console.log(x.er('URL tidak valid!')); process.exit(1); }
    await processUrl(cliUrl, storageDir);
    process.exit(0);
  }

  let first = true;
  do {
    if (!first) console.log('');
    first = false;
    const url = await askUrl();
    await processUrl(url, storageDir);
  } while (await askLagi());

  console.log(`\n${x.h('  またね 👋  Sampai jumpa!\n')}`);
  process.exit(0);
}

main().catch(e => {
  console.log(x.er('Fatal: ' + e.message));
  process.exit(1);
});
