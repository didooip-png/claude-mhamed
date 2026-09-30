/**
 * Fabrique les documents PDF à partir du contenu unique de l'aide (packages/shared/src/help) et des
 * captures d'écran : manuel de l'administrateur, manuel du préparateur, aide-mémoire (1 page), FAQ.
 * Chaque fiche occupe sa propre page (rendue séparément puis assemblée) : le sommaire porte ainsi
 * des numéros de page exacts, et les pieds de page sont tracés à l'assemblage.
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  CHEAT_SHEET,
  CHEAT_SHEET_SUBTITLE,
  CHEAT_SHEET_TITLE,
  FAQ,
  HELP_ROLE_LABELS,
  faqFor,
  manualFor,
  parseAnswer,
} from '@pharmastock/shared';
import {
  CACHE_DIR,
  chromiumPath,
  DOC_VERSION,
  OUT_DIR,
  ROOT,
  SHOTS_DIR,
  WEB_PUBLIC_DIR,
} from './env.mjs';

const FONT_DIR = resolve(ROOT, 'apps/web/node_modules/@fontsource-variable/inter/files');
const ICON = resolve(ROOT, 'apps/web/public/icon-512.png');
const HTML_DIR = resolve(CACHE_DIR, 'html');

const KEY_SVG =
  '<svg class="key" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg>';

const esc = (s) =>
  String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('🔑', '\u0000');
/** Texte sûr pour le HTML, avec la clé 🔑 remplacée par une icône vectorielle. */
const t = (s) => esc(s).replaceAll('\u0000', KEY_SVG);

const CSS = `
@font-face { font-family: 'Inter'; font-weight: 100 900; src: url('file://${FONT_DIR}/inter-latin-wght-normal.woff2') format('woff2'); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: 'Inter'; font-weight: 100 900; src: url('file://${FONT_DIR}/inter-latin-ext-wght-normal.woff2') format('woff2'); unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF; }
:root { --primary: oklch(0.51 0.09 186); --primary-soft: oklch(0.96 0.03 186); --ink: oklch(0.21 0.02 264); --muted: oklch(0.5 0.02 257); --line: oklch(0.9 0.008 247); --warn: oklch(0.96 0.05 85); --warn-line: oklch(0.8 0.12 85); }
* { box-sizing: border-box; }
.pg { break-before: page; }
@page { size: A4; margin: 15mm 16mm 20mm 16mm; }
html { font-family: 'Inter', 'DejaVu Sans', sans-serif; color: var(--ink); font-size: 10.5pt; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-feature-settings: 'cv11', 'ss01'; }
body { margin: 0; }
h1, h2, h3, p, ol, ul, figure { margin: 0; }
.key { width: 1em; height: 1em; vertical-align: -0.12em; color: oklch(0.6 0.13 70); }
/* Couverture */
.cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 6mm; padding-left: 6mm; border-left: 5mm solid var(--primary); }
.cover img { width: 30mm; height: 30mm; border-radius: 6mm; }
.cover .brand { font-size: 13pt; letter-spacing: .12em; text-transform: uppercase; color: var(--primary); font-weight: 700; }
.cover h1 { font-size: 34pt; line-height: 1.1; font-weight: 800; letter-spacing: -.02em; }
.cover .sub { font-size: 14pt; color: var(--muted); max-width: 120mm; }
.cover .meta { margin-top: 14mm; font-size: 10pt; color: var(--muted); line-height: 1.9; }
.cover .meta b { color: var(--ink); }
.cover .line { display: inline-block; width: 80mm; border-bottom: 1px solid var(--muted); }
/* Sommaire */
.toc h1 { font-size: 22pt; margin-bottom: 6mm; }
.toc .row { display: flex; gap: 2mm; align-items: baseline; padding: .6mm 0; }
.toc .row .dots { flex: 1; border-bottom: 1px dotted oklch(0.7 0.01 250); transform: translateY(-1mm); }
.toc .chap { font-weight: 700; margin-top: 3.2mm; color: var(--primary); }
.toc .sub { padding-left: 8mm; font-size: 9.5pt; }
.toc .num { min-width: 7mm; }
/* Ouverture de chapitre */
.opener { height: 240mm; display: flex; flex-direction: column; justify-content: center; }
.opener .no { font-size: 60pt; font-weight: 800; color: var(--primary); line-height: 1; }
.opener h1 { font-size: 28pt; margin: 3mm 0 6mm; font-weight: 800; letter-spacing: -.01em; }
.opener p { font-size: 12pt; color: var(--muted); max-width: 135mm; }
.opener ul { margin-top: 10mm; padding: 0; list-style: none; display: grid; gap: 1.6mm; }
.opener li { padding-left: 6mm; position: relative; }
.opener li::before { content: ''; position: absolute; left: 0; top: 2.6mm; width: 2.4mm; height: 2.4mm; background: var(--primary); border-radius: 50%; }
/* Fiche */
.topic .crumb { font-size: 8.5pt; text-transform: uppercase; letter-spacing: .1em; color: var(--primary); font-weight: 700; }
.topic h2 { font-size: 19pt; line-height: 1.2; margin: 1mm 0 3mm; font-weight: 800; letter-spacing: -.01em; }
.topic .summary { font-size: 11pt; color: oklch(0.32 0.02 260); margin-bottom: 4mm; }
figure { margin: 0 0 5mm; text-align: center; break-inside: avoid; }
figure img { max-width: 100%; max-height: 96mm; object-fit: contain; border: 1px solid var(--line); border-radius: 2mm; box-shadow: 0 1px 4px rgba(0,0,0,.12); }
figcaption { font-size: 8.5pt; color: var(--muted); margin-top: 1.5mm; }
h3 { font-size: 9pt; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); margin: 4mm 0 2mm; }
ol.steps { list-style: none; padding: 0; counter-reset: s; display: grid; gap: 2.2mm; }
ol.steps li { counter-increment: s; position: relative; padding-left: 9mm; break-inside: avoid; }
ol.steps li::before { content: counter(s); position: absolute; left: 0; top: .3mm; width: 6mm; height: 6mm; border-radius: 50%; background: oklch(0.6 0.2 18); color: #fff; font-weight: 700; font-size: 9.5pt; line-height: 6mm; text-align: center; }
.box { border-radius: 2mm; padding: 2.6mm 3.4mm; margin-top: 3mm; break-inside: avoid; }
.box.role { background: var(--primary-soft); border: 1px solid oklch(0.85 0.05 186); }
.box.role b { color: var(--primary); }
.box.tip { border-left: 1.2mm solid var(--primary); background: oklch(0.975 0.01 186); }
.box.warn { background: var(--warn); border: 1px solid var(--warn-line); }
.box b.lab { font-size: 8.5pt; text-transform: uppercase; letter-spacing: .08em; }
.box ul { padding-left: 4.5mm; margin-top: 1mm; }
table.keys { border-collapse: collapse; width: 100%; break-inside: avoid; }
table.keys td { padding: 1mm 2mm; border-bottom: 1px solid var(--line); }
table.keys td:first-child { width: 28mm; }
kbd { font-family: 'DejaVu Sans Mono', monospace; font-size: 8.5pt; border: 1px solid oklch(0.75 0.01 250); border-bottom-width: 2px; border-radius: 1.4mm; padding: .2mm 1.6mm; background: oklch(0.98 0.003 250); }
/* FAQ */
.faq h1 { font-size: 24pt; margin-bottom: 2mm; font-weight: 800; }
.faq .lead { color: var(--muted); margin-bottom: 6mm; }
.faq .q { break-inside: avoid; margin-bottom: 5mm; padding-bottom: 4mm; border-bottom: 1px solid var(--line); }
.faq .q h2 { font-size: 12pt; margin-bottom: 1.6mm; color: var(--primary); }
.faq .q p { margin-bottom: 1.4mm; }
.faq .q ol { padding-left: 5mm; display: grid; gap: 1mm; margin: 1mm 0 1.4mm; }
/* Aide-mémoire : une seule page A4 */
.memo { height: 262mm; display: flex; flex-direction: column; font-size: 10.4pt; line-height: 1.4; }
.memo header { display: flex; align-items: center; gap: 4mm; border-bottom: 1.2mm solid var(--primary); padding-bottom: 2.5mm; margin-bottom: 3mm; }
.memo header img { width: 13mm; height: 13mm; border-radius: 3mm; }
.memo h1 { font-size: 19pt; font-weight: 800; line-height: 1.1; }
.memo header p { color: var(--muted); font-size: 9.5pt; }
.memo .cols { columns: 2; column-gap: 7mm; flex: 1; }
.memo section { break-inside: avoid; margin-bottom: 4mm; }
.memo h2 { font-size: 11.5pt; color: var(--primary); margin-bottom: 1.2mm; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
.memo ol, .memo ul { padding-left: 4.6mm; display: grid; gap: .8mm; }
.memo dl { display: grid; grid-template-columns: 17mm 1fr; gap: 1.1mm 2mm; align-items: baseline; margin: 0; }
.memo dt { margin: 0; } .memo dd { margin: 0; }
.memo footer { border-top: 1px solid var(--line); padding-top: 2mm; font-size: 8pt; color: var(--muted); display: flex; justify-content: space-between; }
`;

const imgCache = new Map();
function dataUri(path, mime) {
  if (!imgCache.has(path))
    imgCache.set(path, `data:${mime};base64,${readFileSync(path).toString('base64')}`);
  return imgCache.get(path);
}

/** Capture d'un écran pour un rôle, à défaut celle de l'autre rôle. */
function shotFor(id, role) {
  if (!id) return null;
  const other = role === 'ADMIN' ? 'PREPARER' : 'ADMIN';
  for (const r of [role, other]) {
    const file = resolve(SHOTS_DIR, `${id}.${r}.jpg`);
    if (existsSync(file)) return dataUri(file, 'image/jpeg');
  }
  return null;
}

const doc = (body, title) =>
  `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;

// ------------------------------------------------------------------------- Blocs HTML
function topicHtml(topic, role, chapterTitle, missing) {
  const notes = topic.roleNotes?.[role];
  const src = shotFor(topic.shot, role);
  if (topic.shot && !src) missing.add(topic.shot);
  return `<article class="topic">
  <div class="crumb">${t(chapterTitle)}</div>
  <h2>${t(topic.title)}</h2>
  <p class="summary">${t(topic.summary)}</p>
  ${src ? `<figure><img src="${src}" alt=""><figcaption>${t(topic.shotCaption ?? topic.title)}</figcaption></figure>` : ''}
  <h3>Pas à pas</h3>
  <ol class="steps">${topic.steps.map((s) => `<li>${t(s)}</li>`).join('')}</ol>
  ${notes?.length ? `<div class="box role"><b class="lab">Pour le rôle ${esc(HELP_ROLE_LABELS[role])}</b><ul>${notes.map((n) => `<li>${t(n)}</li>`).join('')}</ul></div>` : ''}
  ${topic.tips?.length ? `<div class="box tip"><b class="lab">À savoir</b><ul>${topic.tips.map((n) => `<li>${t(n)}</li>`).join('')}</ul></div>` : ''}
  ${topic.warnings?.length ? `<div class="box warn"><b class="lab">Attention</b><ul>${topic.warnings.map((n) => `<li>${t(n)}</li>`).join('')}</ul></div>` : ''}
  ${topic.shortcuts?.length ? `<h3>Raccourcis clavier</h3><table class="keys">${topic.shortcuts.map(([k, a]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${t(a)}</td></tr>`).join('')}</table>` : ''}
</article>`;
}

function answerHtml(lines) {
  return parseAnswer(lines)
    .map((b) =>
      b.type === 'p'
        ? `<p>${t(b.text)}</p>`
        : `<ol>${b.items.map((i) => `<li>${t(i)}</li>`).join('')}</ol>`,
    )
    .join('');
}

const faqHtml = (entries, heading, lead) => `<section class="faq">
  <h1>${t(heading)}</h1>
  <p class="lead">${t(lead)}</p>
  ${entries.map((f) => `<div class="q"><h2>${t(f.question)}</h2>${answerHtml(f.answer)}</div>`).join('')}
</section>`;

const longDate = () =>
  new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

function coverHtml(title, subtitle) {
  return `<div class="cover">
  <img src="${dataUri(ICON, 'image/png')}" alt="">
  <div class="brand">PharmaStock</div>
  <h1>${t(title)}</h1>
  <p class="sub">${t(subtitle)}</p>
  <div class="meta"><b>Version</b> ${esc(DOC_VERSION)} · ${esc(longDate())}<br><b>Établissement</b> <span class="line"></span></div>
</div>`;
}

// ------------------------------------------------------------------------- Rendu PDF
async function toPdf(browser, name, html, title) {
  await mkdir(HTML_DIR, { recursive: true });
  const file = resolve(HTML_DIR, `${name}.html`);
  await writeFile(file, doc(html, title));
  const page = await browser.newPage();
  await page.goto(`file://${file}`);
  await page.evaluate(() => document.fonts.ready);
  const pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '15mm', bottom: '20mm', left: '16mm', right: '16mm' },
  });
  await page.close();
  return new Uint8Array(pdf);
}

async function pageCount(bytes) {
  return (await PDFDocument.load(bytes)).getPageCount();
}

/** Assemble les morceaux, ajoute les pieds de page (sauf couverture) et les métadonnées. */
async function assemble(parts, { title, footerLabel }) {
  const out = await PDFDocument.create();
  for (const bytes of parts) {
    const src = await PDFDocument.load(bytes);
    for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
  }
  const font = await out.embedFont(StandardFonts.Helvetica);
  const total = out.getPageCount();
  out.getPages().forEach((page, i) => {
    if (i === 0) return;
    const { width } = page.getSize();
    const grey = rgb(0.45, 0.47, 0.5);
    page.drawLine({
      start: { x: 45, y: 42 },
      end: { x: width - 45, y: 42 },
      thickness: 0.5,
      color: rgb(0.85, 0.86, 0.88),
    });
    page.drawText(footerLabel, { x: 45, y: 28, size: 8, font, color: grey });
    const label = `Page ${i + 1} / ${total}`;
    page.drawText(label, {
      x: width - 45 - font.widthOfTextAtSize(label, 8),
      y: 28,
      size: 8,
      font,
      color: grey,
    });
  });
  out.setTitle(title);
  out.setAuthor('PharmaStock');
  out.setSubject('Documentation utilisateur');
  out.setLanguage('fr-FR');
  out.setCreator('PharmaStock — tools/docs');
  return out.save();
}

async function writeOut(fileName, bytes) {
  for (const dir of [OUT_DIR, WEB_PUBLIC_DIR]) {
    await mkdir(dir, { recursive: true });
    await writeFile(resolve(dir, fileName), bytes);
  }
  console.log(`  → ${fileName} (${Math.round(bytes.length / 1024)} Ko)`);
}

// ------------------------------------------------------------------------- Documents
async function buildManual(browser, role, missing) {
  const title = `Manuel ${role === 'ADMIN' ? 'de l’administrateur' : 'du préparateur'}`;
  const chapters = manualFor(role);
  const faq = faqFor(role);
  console.log(
    `• ${title} : ${chapters.length} chapitres, ${chapters.reduce((n, c) => n + c.topics.length, 0)} fiches`,
  );

  // Morceaux : une page d'ouverture par chapitre, puis une ou plusieurs pages par fiche.
  const parts = []; // { html }
  const toc = [];
  for (const [ci, { chapter, topics }] of chapters.entries()) {
    const no = ci + 1;
    const intro = chapter.intro[role] ?? chapter.intro.default;
    const entry = { no, title: chapter.title, index: parts.length, topics: [] };
    parts.push({
      html: `<div class="opener"><div class="no">${no}</div><h1>${t(chapter.title)}</h1><p>${t(intro)}</p><ul>${topics.map((x) => `<li>${t(x.title)}</li>`).join('')}</ul></div>`,
    });
    for (const topic of topics) {
      entry.topics.push({ title: topic.title, index: parts.length });
      parts.push({ html: topicHtml(topic, role, chapter.title, missing) });
    }
    toc.push(entry);
  }
  const faqNo = chapters.length + 1;
  parts.push({
    html: faqHtml(
      faq,
      `${faqNo}. Que faire si…`,
      'Les situations qui reviennent au comptoir, et la marche à suivre.',
    ),
  });

  // Passe 1 : combien de pages occupe chaque morceau ? (chacun commence sur une page neuve)
  const counts = [];
  for (const [i, part] of parts.entries()) {
    counts.push(await pageCount(await toPdf(browser, `${role}-m${i}`, part.html, title)));
  }
  const startOf = (idx) => counts.slice(0, idx).reduce((a, b) => a + b, 0);
  const row = (cls, lead, label, page) =>
    `<div class="row ${cls}">${lead}<span>${t(label)}</span><span class="dots"></span><span>${page}</span></div>`;
  const tocRows = (offset) =>
    toc
      .map(
        (c) =>
          row('chap', `<span class="num">${c.no}</span>`, c.title, offset + startOf(c.index) + 1) +
          c.topics.map((tp) => row('sub', '', tp.title, offset + startOf(tp.index) + 1)).join(''),
      )
      .join('') +
    row(
      'chap',
      `<span class="num">${faqNo}</span>`,
      'Que faire si…',
      offset + startOf(parts.length - 1) + 1,
    );
  const tocHtml = (offset) => `<section class="toc"><h1>Sommaire</h1>${tocRows(offset)}</section>`;
  // Le sommaire est rendu deux fois : sa longueur ne dépend pas des numéros qu'il affiche.
  const tocPages = await pageCount(await toPdf(browser, `${role}-toc`, tocHtml(1), 'Sommaire'));

  // Passe 2 : un seul document (la police et les styles ne sont embarqués qu'une fois).
  const cover = coverHtml(
    title,
    'Pas à pas illustrés, écran par écran, avec l’aide « Que faire si… ».',
  );
  const html =
    `<div>${cover}</div>` +
    `<div class="pg">${tocHtml(1 + tocPages)}</div>` +
    parts.map((p) => `<div class="pg">${p.html}</div>`).join('');
  const pdf = await toPdf(browser, `${role}-manual`, html, `PharmaStock — ${title}`);
  const expected = 1 + tocPages + counts.reduce((a, b) => a + b, 0);
  const actual = await pageCount(pdf);
  if (actual !== expected) {
    console.warn(
      `  ⚠ ${actual} pages obtenues, ${expected} attendues : les numéros du sommaire sont décalés`,
    );
  }
  const bytes = await assemble([pdf], {
    title: `PharmaStock — ${title}`,
    footerLabel: `PharmaStock - ${title} - version ${DOC_VERSION}`,
  });
  await writeOut(
    `PharmaStock-Manuel-${role === 'ADMIN' ? 'Administrateur' : 'Preparateur'}.pdf`,
    bytes,
  );
}

async function buildMemo(browser) {
  console.log('• Aide-mémoire du préparateur');
  const block = (b) => {
    const inner =
      b.kind === 'keys'
        ? `<dl>${b.items.map(([k, v]) => `<dt><kbd>${esc(k)}</kbd></dt><dd>${t(v)}</dd>`).join('')}</dl>`
        : b.kind === 'steps'
          ? `<ol>${b.items.map((i) => `<li>${t(i)}</li>`).join('')}</ol>`
          : `<ul>${b.items.map((i) => `<li>${t(i)}</li>`).join('')}</ul>`;
    return `<section><h2>${t(b.title)}</h2>${inner}</section>`;
  };
  const html = `<div class="memo">
  <header><img src="${dataUri(ICON, 'image/png')}" alt=""><div><h1>${t(CHEAT_SHEET_TITLE)}</h1><p>${t(CHEAT_SHEET_SUBTITLE)}</p></div></header>
  <div class="cols">${CHEAT_SHEET.map(block).join('')}</div>
  <footer><span>PharmaStock · version ${esc(DOC_VERSION)}</span><span>Un doute ? Bouton « ? » en haut de l’écran, ou demandez à un administrateur.</span></footer>
</div>`;
  const pdf = await toPdf(browser, 'memo', html, CHEAT_SHEET_TITLE);
  const pages = await pageCount(pdf);
  if (pages !== 1)
    throw new Error(
      `L’aide-mémoire doit tenir sur une page (${pages} pages obtenues) : raccourcir memo.ts`,
    );
  const doc1 = await PDFDocument.load(pdf);
  doc1.setTitle(`PharmaStock — ${CHEAT_SHEET_TITLE}`);
  doc1.setAuthor('PharmaStock');
  doc1.setLanguage('fr-FR');
  await writeOut('PharmaStock-Aide-memoire-Preparateur.pdf', await doc1.save());
}

async function buildFaq(browser) {
  console.log('• FAQ « Que faire si… »');
  const common = FAQ.filter((f) => f.roles.includes('PREPARER'));
  const adminOnly = FAQ.filter((f) => !f.roles.includes('PREPARER'));
  const cover = await toPdf(
    browser,
    'faq-cover',
    coverHtml('Que faire si…', 'Les situations qui reviennent au comptoir, et la marche à suivre.'),
    'Que faire si…',
  );
  const a = await toPdf(
    browser,
    'faq-common',
    faqHtml(
      common,
      'Pour tous',
      'Ces réponses concernent aussi bien les préparateurs que les administrateurs.',
    ),
    'FAQ',
  );
  const parts = [cover, a];
  if (adminOnly.length)
    parts.push(
      await toPdf(
        browser,
        'faq-admin',
        faqHtml(
          adminOnly,
          'Réservé aux administrateurs',
          'Configuration, sauvegardes, comptes et postes.',
        ),
        'FAQ administrateur',
      ),
    );
  const bytes = await assemble(parts, {
    title: 'PharmaStock — Que faire si…',
    footerLabel: `PharmaStock - Que faire si... - version ${DOC_VERSION}`,
  });
  await writeOut('PharmaStock-FAQ-Que-faire-si.pdf', bytes);
}

export async function renderAll({ strict = false } = {}) {
  await mkdir(OUT_DIR, { recursive: true });
  const missing = new Set();
  const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--lang=fr-FR'] });
  try {
    await buildManual(browser, 'PREPARER', missing);
    await buildManual(browser, 'ADMIN', missing);
    await buildMemo(browser);
    await buildFaq(browser);
  } finally {
    await browser.close();
  }
  if (missing.size) {
    console.warn(`\nCaptures manquantes (${missing.size}) : ${[...missing].join(', ')}`);
    if (strict) throw new Error('Captures manquantes');
  }
}
