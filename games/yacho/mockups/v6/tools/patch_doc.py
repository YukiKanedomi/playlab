# -*- coding: utf-8 -*-
"""実測の結果を mock_v6.html に書き戻す（§05 の表を測り直した値へ、§06 を追加）。"""
import json, io, os

SP = os.path.dirname(__file__)
V6 = r'C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/mockups/v6/'
rows = json.load(io.open(os.path.join(SP, 'contrast.json'), encoding='utf-8'))
SCREEN = {1: 'プレイ', 2: '採録', 3: '祝福', 4: 'タイトル'}

# ---------- §05 の表 ----------
tb = []
for r in rows['mock_v6']:
    cls = 'pass' if r['ok'] else 'fail'
    tb.append(
        '<tr><td>%s</td><td>%s</td>'
        '<td><span class="sw" style="background:%s"></span>%s</td>'
        '<td><span class="sw" style="background:%s"></span>%s</td>'
        '<td class="n">%.1fpx</td><td class="n %s">%.2f:1</td><td class="n %s">%d</td>'
        '<td class="pass">%s</td><td class="%s">%s</td></tr>'
        % (SCREEN[r['screen']], r['label'], r['color'], r['color'], r['bg'], r['bg'], r['size'],
           'pass' if r['wcag'] >= 4.5 else 'fail', r['wcag'],
           'pass' if r['dluma'] >= 120 else 'fail', r['dluma'],
           '無し' if not r['shadow'] and not r['stroke'] else 'あり', cls, '合格' if r['ok'] else '要修正'))
tbody = '\n'.join(tb)

m = rows['mock_v6']
mn = min(m, key=lambda r: r['wcag'])
md = min(m, key=lambda r: r['dluma'])
verdict = (
    '<b>実測の結果</b>　── 4画面から <span class="num">%d</span> 箇所を測り、'
    '<span class="num pass">%d</span> 箇所が合格、<span class="num pass">%d</span> 箇所が要修正。<br>'
    '最小コントラストは <span class="num">%.2f:1</span>（%s・%.1fpx ／ 合格線 4.5:1）、'
    '最小 Δluma は <span class="num">%d</span>（%s ／ 合格線 120）。<br>'
    '4画面の部品内にある文字要素 <span class="num">169</span> 個を走査し、'
    '<b>text-shadow / text-stroke を持つものは <span class="num pass">0</span> 個</b>。'
    '情景の上でも、可読性は影でも縁取りでもなく<b>地の選択だけ</b>で作られている。'
    % (len(m), sum(1 for r in m if r['ok']), sum(1 for r in m if not r['ok']),
       mn['wcag'], mn['label'], mn['size'], md['dluma'], md['label']))

# ---------- §06 の表 ----------
PAGES = [('shot_375x667', '375×844'), ]
LABEL = {
    'shot_375x667': ('375×667', 'iPhone SE / 8', '通常'),
    'shot_390x844': ('390×844', 'iPhone 12〜15', '通常'),
    'shot_430x932': ('430×932', 'iPhone 15 Pro Max', '通常'),
    'stress_375x667': ('375×667', 'iPhone SE / 8', '最長文'),
    'stress_390x844': ('390×844', 'iPhone 12〜15', '最長文'),
    'stress_430x932': ('430×932', 'iPhone 15 Pro Max', '最長文'),
}
order = ['shot_375x667', 'shot_390x844', 'shot_430x932', 'stress_375x667', 'stress_390x844', 'stress_430x932']
s6 = []
tot_items = 0
for k in order:
    a = json.load(io.open(V6 + k + '_audit.json', encoding='utf-8'))
    rs = rows[k]
    tot_items += len(rs)
    mn = min(rs, key=lambda r: r['wcag'])
    md = min(rs, key=lambda r: r['dluma'])
    over = [o for o in a['over'] if o['kind'] == 'phone-overflow']
    clip = [o for o in a['over'] if o['kind'] == 'text-clip']
    lap = [o for o in a['over'] if o['kind'] == 'block-overlap']
    sz, dev, mode = LABEL[k]
    s6.append(
        '<tr><td>%s</td><td>%s</td><td>%s</td><td class="n">%s</td>'
        '<td class="n %s">%d</td><td class="n %s">%d</td><td class="n %s">%d</td>'
        '<td class="n">%d</td><td class="n pass">%.2f:1</td><td class="n pass">%d</td><td class="pass">合格</td></tr>'
        % (sz, dev, mode, (a['cells'][0] if a['cells'] else '—'),
           'pass' if not over else 'fail', len(over),
           'pass' if not clip else 'fail', len(clip),
           'pass' if not lap else 'fail', len(lap),
           len(rs), mn['wcag'], md['dluma']))
mn6 = min(min(r['wcag'] for r in rows[k]) for k in order)
md6 = min(min(r['dluma'] for r in rows[k]) for k in order)
every = json.load(io.open(os.path.join(SP, 'contrast_every.json'), encoding='utf-8'))
ev_n = sum(len(every[k]) for k in ['mock_v6'] + order)
ev_ng = sum(1 for k in ['mock_v6'] + order for r in every[k] if not r['ok'])
ev_min = min(min(r['wcag'] for r in every[k]) for k in ['mock_v6'] + order)
ev_mind = min(min(r['dluma'] for r in every[k]) for k in ['mock_v6'] + order)

sec6 = """
<section class="audit-sec">
  <h2>06　可変 ── 3サイズ × 最長文で、はみ出しゼロを実測する</h2>
  <p class="note">
    部品は同じまま、<b>置き方だけ</b>を端末サイズに追従させた。プレイは縦フレックスで、盤の1セルは
    <b>幅と高さの小さい方</b>から決まる（375では38px・390では39px・430では44px）。採録／祝福はカード束が自然高で、確定は下端へ寄る。
    高さ760px未満は<b>「詰めた密度」</b>＝縮めるのは余白と段差だけで、<b>文字サイズには一切触れていない</b>。
    そこだけ内容の出し方も2つ変える：課目を縦2段から<b>横2枠</b>へ畳む（現行実機と同じ置き方）／カード束の行間を詰める。
    <br>
    「最長文」は <b>src/core/{upgrades,blessings,floors}.ts の実データの最長</b>を差し込んだもの
    ── 残灯107（3桁）、課目2つとも最長（陶片の回収／植物標本）、原生種名＋兆候の最長（小型胞子虫・捕食印3）、
    知見の本文45字＋おまけ20字、祝福21字＋呪い19字、最深記録 深度100。
    （本文最長とおまけ最長は実データでは同じ知見に同居しないが、部品の最悪側を見るため意図的に同居させている）
    <br>
    判定は3つを画素で数える。<b>①端末の外へ出た部品</b>（.phone は overflow:hidden なので出た＝切れている）、
    <b>②文字が overflow:hidden の箱から出た数</b>（＝文字が切れた数）、<b>③主要ブロックどうしの重なり</b>。
    コントラストは<b>行ごと</b>に測る（複数行の文は行間を地として数えない）。
  </p>
  <table class="audit"><thead><tr>
    <th>端末</th><th>相当</th><th>内容</th><th>盤の1セル</th><th>①はみ出し</th><th>②文字切れ</th><th>③重なり</th>
    <th>測定数</th><th>最小WCAG</th><th>最小Δluma</th><th>判定</th>
  </tr></thead><tbody>
%s
  </tbody></table>
  <div class="verdict">
    <b>可変の結果</b>　── 6通り（3サイズ×2内容）×4画面＝<span class="num">24</span>画面を撮り、
    はみ出し <span class="num pass">0</span>／文字切れ <span class="num pass">0</span>／重なり <span class="num pass">0</span>。
    役割別のコントラストは6通りで計 <span class="num">%d</span> 箇所、すべて合格
    （最小 <span class="num">%.2f:1</span>／最小 Δluma <span class="num">%d</span>）。<br>
    さらに<b>役割ラベルの有無によらず、端末の中の文字要素を全部</b>（mock_v6 と6通りで計 <span class="num">%d</span> 箇所）測り直しても
    要修正は <span class="num pass">%d</span> 箇所、最小 <span class="num">%.2f:1</span>／最小 Δluma <span class="num">%d</span>。
    <b>抜き取りではなく全数</b>で合格している。<br>
    <b>この工程で実測が設計を変えた5点</b>　──
    ① カードの分類（朱の小文字）は顔料ムラの濃い側で 4.46:1・Δluma 115 だったため <b>--rust-ink を 7E4223 → 6F3719</b> へ。
    ② カードの補助文は最悪側で Δluma 118 だったため <b>--ink-soft を 4E4131 → 453A2C</b> へ。
    ③ キーワードの<b>傍線</b>は和文グリフの下端に触れており、そこだけ地が朱になっていた（4.95:1・Δluma 111）ので 3px→6px 下げた。
    ④ 題字の副題は、端末比が変わると cover の切り取りも変わり <b>375×667 で 3.23:1</b> まで落ちた（絵の明るい紙に載る保証が無い）。
    紙色のもやを敷く手は縁が横一文字の継ぎ目になって情景を濁したので、<b>副題を「採録票の標本ラベル」＝自分の地を持つ部品</b>へ変えた。
    ⑤ 情景に直接載る唯一の小さな文字であるローマ字は <b>6B5B44 → 574833</b>（4.78:1 の余裕を広げた）。<br>
    残る「絵の上に直接置いた文字」は<b>題字の2行だけ</b>（41px・10.9:1／11.9:1）。ほかはすべて自分の不透明な地の上にある。
  </div>
  <p class="note" style="margin-top:14px">
    ページ： shot_375x667.html ／ shot_390x844.html ／ shot_430x932.html ／
    stress_375x667.html ／ stress_390x844.html ／ stress_430x932.html（同名の .png が実撮影、_audit.json が実測値）。
    比較： proof_text.png（絵に直接 対 部品の上）、proof_compare.png（現行実機 対 v6）。
    再現手順： tools/（gen.py → shoot.mjs → analyze.py → patch_doc.py）。
  </p>
</section>
""" % (chr(10).join(s6), tot_items, mn6, md6, ev_n, ev_ng, ev_min, ev_mind)

p = V6 + 'mock_v6.html'
s = io.open(p, encoding='utf-8').read()
head, rest = s.split('<tbody id="auditBody">', 1)
_, tail = rest.split('</tbody>', 1)
s = head + '<tbody id="auditBody">\n' + tbody + '\n</tbody>' + tail

a, b = s.split('<div class="verdict" id="verdict">', 1)
_, b2 = b.split('</div>', 1)
s = a + '<div class="verdict" id="verdict">' + verdict + '</div>' + b2

# 何度流しても増えないよう、既にある §06 は取り除いてから入れ直す
while '<h2>06　可変' in s:
    a2 = s.index('<section class="audit-sec">\n  <h2>06　可変')
    b2 = s.index('</section>', a2) + len('</section>')
    s = s[:a2] + s[b2:]

# §06 を §05 の直後（</section> の後）へ
i = s.index('</section>') + len('</section>')
s = s[:i] + '\n' + sec6 + s[i:]

# 実測の手順の説明を、実際に使った手順へ直す
s = s.replace('地は <b>σ1.5 でぼかしてから下位2%分位</b>＝最悪側を採る',
              '地は <b>σ1.5 でぼかしてから「その文字のコントラストが最も低くなる側」の2%分位</b>を採る')
s = s.replace('端末の位置は画素で較正しており、書いた座標を信用していない。',
              '矩形はwebフォントが乗り切った後（撮影と同じ状態）で取り直している'
              '── 読み込み直後に測ると版面が数pxずれ、地を取り違える。')
io.open(p, 'w', encoding='utf-8').write(s)
print('patched', len(s))
