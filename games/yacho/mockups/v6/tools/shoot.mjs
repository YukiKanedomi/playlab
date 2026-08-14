// 生成したページを Edge で描画し、(1)通常 (2)文字だけ消した同一ページ の2枚を撮り、
// あわせて「はみ出し」と「文字の矩形」を実測して JSON に書き出す。
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const targets = process.argv.slice(2); // html パスの列

const OVERFLOW = () => {
  const out = [];
  const phones = [...document.querySelectorAll('.phone')];
  phones.forEach((p, pi) => {
    const pb = p.getBoundingClientRect();
    // 1) 端末の外へ出た要素（.phone は overflow:hidden なので、出た＝切れている）
    p.querySelectorAll('*').forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      // 意図的に端末の縁へ流す装飾（スクリム・にじみ）は対象外。文字を持つ／触れる部品だけを見る
      if (!(el.textContent || '').trim() && cs.pointerEvents === 'none') return;
      const b = el.getBoundingClientRect();
      if (b.width < 0.5 && b.height < 0.5) return;
      const over = Math.max(pb.left - b.left, b.right - pb.right, pb.top - b.top, b.bottom - pb.bottom);
      if (over > 0.6) {
        out.push({ kind: 'phone-overflow', phone: pi + 1, sel: el.className || el.tagName, px: +over.toFixed(1),
                   text: (el.textContent || '').trim().slice(0, 24) });
      }
    });
    // 2) 文字が、overflow:hidden の先祖の箱からはみ出していないか（＝文字が切れていないか）
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    let n;
    while ((n = walker.nextNode())) {
      if (!n.textContent.trim()) continue;
      const rg = document.createRange();
      rg.selectNodeContents(n);
      const rects = [...rg.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
      if (!rects.length) continue;
      const box = rects.reduce((a, r) => ({
        l: Math.min(a.l, r.left), t: Math.min(a.t, r.top), r: Math.max(a.r, r.right), b: Math.max(a.b, r.bottom),
      }), { l: 1e9, t: 1e9, r: -1e9, b: -1e9 });
      let el = n.parentElement;
      while (el && p.contains(el)) {
        const cs = getComputedStyle(el);
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
          const cb = el.getBoundingClientRect();
          const over = Math.max(cb.left - box.l, box.r - cb.right, cb.top - box.t, box.b - cb.bottom);
          if (over > 0.6) {
            const key = pi + '|' + n.textContent.trim().slice(0, 12) + '|' + el.className;
            if (!seen.has(key)) {
              seen.add(key);
              out.push({ kind: 'text-clip', phone: pi + 1, sel: String(el.className).slice(0, 40),
                         px: +over.toFixed(1), text: n.textContent.trim().slice(0, 26) });
            }
          }
        }
        el = el.parentElement;
      }
    }
    // 3) 部品どうしの重なり（同じ深さの兄弟が重なっていないか）を主要ブロックだけ見る
    const blocks = [...p.querySelectorAll('.ui > *, .ui--play > *, .ui--deck > *')];
    for (let i = 0; i < blocks.length; i++)
      for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i].getBoundingClientRect(), b = blocks[j].getBoundingClientRect();
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 1 && oy > 1)
          out.push({ kind: 'block-overlap', phone: pi + 1, px: +Math.min(ox, oy).toFixed(1),
                     sel: blocks[i].className + ' × ' + blocks[j].className, text: '' });
      }
  });
  return out;
};

// ページ内の実測スクリプトは読み込み直後（＝webフォントが乗る前）に走るため、
// 版面が数px ずれた状態の矩形を掴む。撮影と同じ状態で測り直す。
const COLLECT = () => {
  const SCREENS = [...document.querySelectorAll('.phone')];
  const out = [];
  function ownTextRect(el) {
    const rg = document.createRange();
    let box = null;
    const lines = [];
    el.childNodes.forEach((n) => {
      if (n.nodeType !== 3 || !n.textContent.trim()) return;
      rg.selectNodeContents(n);
      for (const b of rg.getClientRects()) {
        if (b.width < 1 || b.height < 1) continue;
        lines.push({ x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height });
        box = box
          ? { l: Math.min(box.l, b.left), t: Math.min(box.t, b.top), r: Math.max(box.r, b.right), b: Math.max(box.b, b.bottom) }
          : { l: b.left, t: b.top, r: b.right, b: b.bottom };
      }
    });
    if (!box) {
      const b = el.getBoundingClientRect();
      box = { l: b.left, t: b.top, r: b.right, b: b.bottom };
      lines.push({ x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height });
    }
    box.lines = lines;
    return box;
  }
  document.querySelectorAll('[data-a]').forEach((el) => {
    const cs = getComputedStyle(el);
    const bx = ownTextRect(el);
    const host = SCREENS.findIndex((p) => p.contains(el));
    const pr = host >= 0 ? SCREENS[host].getBoundingClientRect() : { left: 0, top: 0 };
    out.push({
      label: el.getAttribute('data-a'), screen: host + 1,
      x: bx.l + scrollX, y: bx.t + scrollY, w: bx.r - bx.l, h: bx.b - bx.t, lines: bx.lines,
      lx: bx.l - pr.left, ly: bx.t - pr.top,
      color: cs.color, fontSize: parseFloat(cs.fontSize), weight: cs.fontWeight,
      shadow: cs.textShadow && cs.textShadow !== 'none' ? cs.textShadow : '',
      stroke: parseFloat(cs.webkitTextStrokeWidth || 0) || 0,
    });
  });
  // 役割ラベルの有無にかかわらず、端末の中の「自分の文字を持つ要素」を全部拾う（取りこぼしの確認用）
  const every = [];
  SCREENS.forEach((p, pi) => {
    p.querySelectorAll('*').forEach((el) => {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own) return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.5) return;
      const bx = ownTextRect(el);
      if (bx.r - bx.l < 1 || bx.b - bx.t < 1) return;
      every.push({
        label: (el.getAttribute('data-a') || (el.className && String(el.className).split(' ')[0]) || el.tagName) +
               '「' + el.textContent.trim().slice(0, 10) + '」',
        screen: pi + 1, x: bx.l + scrollX, y: bx.t + scrollY, w: bx.r - bx.l, h: bx.b - bx.t, lines: bx.lines,
        color: cs.color, fontSize: parseFloat(cs.fontSize), weight: cs.fontWeight,
        shadow: cs.textShadow && cs.textShadow !== 'none' ? cs.textShadow : '',
        stroke: parseFloat(cs.webkitTextStrokeWidth || 0) || 0,
      });
    });
  });
  let scanned = 0, shadowCount = 0;
  document.querySelectorAll('.phone .panel,.phone .card,.phone .btn,.phone .row,.phone .chip,.phone .plaque,.phone .med,.phone .slot,.phone .logo,.phone .iconbtn,.phone .title-sub,.phone .omen').forEach((root) => {
    root.querySelectorAll('*').forEach((n) => {
      if (!n.textContent || !n.textContent.trim()) return;
      scanned++;
      const cs = getComputedStyle(n);
      if (cs.textShadow && cs.textShadow !== 'none') shadowCount++;
      if (parseFloat(cs.webkitTextStrokeWidth || 0) > 0) shadowCount++;
    });
  });
  return { items: out, every, scanned, shadowCount };
};

const browser = await chromium.launch({ channel: 'msedge', args: ['--force-color-profile=srgb', '--font-render-hinting=none'] });
for (const t of targets) {
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1100 } });
  const page = await ctx.newPage();
  await page.goto('file:///' + t.replace(/\\/g, '/'), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
  const fontOk = await page.evaluate(() => ({
    min: document.fonts.check('600 15px "Shippori Mincho"'),
    got: document.fonts.check('500 13px "Zen Kaku Gothic New"'),
    num: document.fonts.check('600 20px "Archivo"'),
  }));
  const audit = await page.evaluate(COLLECT);
  const over = await page.evaluate(OVERFLOW);
  const phoneBoxes = await page.evaluate(() =>
    [...document.querySelectorAll('.phone')].map((p) => {
      const b = p.getBoundingClientRect();
      return { x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height, kind: p.dataset.kind };
    }));
  const cells = await page.evaluate(() =>
    [...document.querySelectorAll('.phone[data-kind=play]')].map((p) => p.style.getPropertyValue('--cell')));
  const base = t.replace(/\.html$/, '');
  await page.screenshot({ path: base + '.png', fullPage: true });
  await page.addStyleTag({ content: '*{color:transparent !important;-webkit-text-fill-color:transparent !important}' });
  await page.waitForTimeout(120);
  await page.screenshot({ path: base + '_bg.png', fullPage: true });
  fs.writeFileSync(base + '_audit.json', JSON.stringify({ fontOk, audit, over, phoneBoxes, cells }, null, 1));
  console.log(path.basename(t), 'fonts', JSON.stringify(fontOk), 'cell', cells.join(','), 'items', audit.items.length,
              'overflow', over.length);
  for (const o of over.slice(0, 12)) console.log('   !', o.kind, o.phone, o.px + 'px', o.sel, o.text);
  await ctx.close();
}
await browser.close();
