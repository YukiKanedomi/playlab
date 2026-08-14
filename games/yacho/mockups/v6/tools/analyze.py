# -*- coding: utf-8 -*-
"""描画された画素からコントラストを実測する。
   ① 通常のPNG ② 文字だけを消した同一PNG（背景・枠・紙目・顔料ムラはそのまま）
   ③ 各文字の実矩形について、②から「その文字が本当に載っている地」を取り、
      WCAG比 と Δluma（Rec.601）を出す。地は最悪側の2%分位を採る。"""
import json, io, sys, os
from PIL import Image, ImageFilter

DSF = 2
PASS_CONTRAST = 4.5   # 本文の合格線
PASS_DLUMA = 120      # ART_GRAMMAR §6.1


def srgb_lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


LIN = [srgb_lin(i) for i in range(256)]


def rel_lum(rgb):
    r, g, b = rgb[:3]
    return 0.2126 * LIN[r] + 0.7152 * LIN[g] + 0.0722 * LIN[b]


def luma601(rgb):
    r, g, b = rgb[:3]
    return 0.299 * r + 0.587 * g + 0.114 * b


def contrast(l1, l2):
    a, b = max(l1, l2), min(l1, l2)
    return (a + 0.05) / (b + 0.05)


def parse_color(s):
    s = s.strip()
    if s.startswith('rgb'):
        parts = s[s.index('(') + 1:s.index(')')].replace('/', ',').split(',')
        v = [float(p.strip().rstrip('%')) for p in parts[:3]]
        return tuple(int(round(x)) for x in v)
    if s.startswith('#'):
        s = s[1:]
        return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))
    raise ValueError(s)


def hexs(rgb):
    return '#%02X%02X%02X' % tuple(rgb[:3])


def measure(page, key='items'):
    """page: html のベース名（拡張子なし）"""
    a = json.load(io.open(page + '_audit.json', encoding='utf-8'))
    im = Image.open(page + '.png').convert('RGB')
    bg = Image.open(page + '_bg.png').convert('RGB').filter(ImageFilter.GaussianBlur(1.5))
    rows = []
    for it in a['audit'][key]:
        col = parse_color(it['color'])
        lt, lu_t = rel_lum(col), luma601(col)
        x, y, w, h = it['x'], it['y'], it['w'], it['h']
        if w < 1 or h < 1:
            continue
        # 行ボックスは字面より上下に張り出すので、中央56%の帯だけを地とみなす。
        # 複数行のときは「行ごと」に帯を取る（行間を地として数えないため）。
        worst, c = None, 1e9
        for ln in (it.get('lines') or [dict(x=x, y=y, w=w, h=h)]):
            lx, ly, lw, lh = ln['x'], ln['y'], ln['w'], ln['h']
            if lw < 1 or lh < 1:
                continue
            cy, hh = ly + lh / 2.0, lh * 0.56
            box = (int(round(lx * DSF)), int(round((cy - hh / 2) * DSF)),
                   int(round((lx + lw) * DSF)), int(round((cy + hh / 2) * DSF)))
            box = (max(0, box[0]), max(0, box[1]), min(bg.width, box[2]), min(bg.height, box[3]))
            if box[2] - box[0] < 2 or box[3] - box[1] < 2:
                continue
            px = list(bg.crop(box).getdata())
            # 「最悪側」＝そのコントラストが最も低くなる側の2%分位
            vals = sorted(px, key=lambda p: contrast(lt, rel_lum(p)))
            wp = vals[max(0, int(len(vals) * 0.02))]
            cc = contrast(lt, rel_lum(wp))
            if cc < c:
                c, worst = cc, wp
        if worst is None:
            continue
        d = abs(lu_t - luma601(worst))
        rows.append(dict(screen=it['screen'], label=it['label'], size=round(it['fontSize'], 1),
                         color=hexs(col), bg=hexs(worst), wcag=round(c, 2), dluma=int(round(d)),
                         shadow=it['shadow'] or '', stroke=it['stroke'],
                         ok=(c >= PASS_CONTRAST and d >= PASS_DLUMA)))
    return rows, a


def main():
    V6 = r'C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/mockups/v6/'
    pages = sys.argv[1:]
    allrows = {}
    for p in pages:
        rows, a = measure(V6 + p, os.environ.get('KEY', 'items'))
        allrows[p] = rows
        bad = [r for r in rows if not r['ok']]
        mn = min(rows, key=lambda r: r['wcag'])
        md = min(rows, key=lambda r: r['dluma'])
        print('== %-18s n=%d NG=%d  min WCAG %.2f (%s %.1fpx)  min dluma %d (%s)  overflow=%d shadow=%d/%d'
              % (p, len(rows), len(bad), mn['wcag'], mn['label'], mn['size'], md['dluma'], md['label'],
                 len(a['over']), a['audit']['shadowCount'], a['audit']['scanned']))
        for r in bad:
            print('   NG %-28s %5.1fpx %s on %s  wcag=%.2f dluma=%d' %
                  (r['label'], r['size'], r['color'], r['bg'], r['wcag'], r['dluma']))
    json.dump(allrows, io.open(os.path.join(os.path.dirname(__file__), 'contrast.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)


if __name__ == '__main__':
    sys.stdout = io.open(os.path.join(os.path.dirname(__file__), 'contrast_report.txt'), 'w', encoding='utf-8')
    main()
    sys.stdout.close()
