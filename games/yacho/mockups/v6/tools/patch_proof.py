# -*- coding: utf-8 -*-
"""proof_text.html の比較表を、実測値で埋める。"""
import json, io, os

SP = os.path.dirname(__file__)
V6 = r'C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/mockups/v6/'
rows = json.load(io.open(os.path.join(SP, 'contrast.json'), encoding='utf-8'))['proof_text']
by = {r['label']: r for r in rows}

PAIRS = [
    ('深度の見出し語', '直接／深度の見出し語', 'メダリオン見出し語'),
    ('深度の数値', '直接／深度の数値', 'メダリオン数値（深度）'),
    ('残灯の見出し語', '直接／残灯の見出し語', '札の見出し語（暗地）'),
    ('残灯の数値（主数値）', '直接／残灯の数値', '残灯の数値（大・暗地の札）'),
    ('課目の見出し', '直接／課目の見出し', 'パネル見出し帯'),
    ('課目の名前', '直接／課目の名前', '課目の名前'),
    ('課目の補助文（本文）', '直接／課目の補助文', '課目の補助文'),
    ('課目の残数（主数値）', '直接／課目の残数', '課目の残数（中）'),
    ('ボタンの文言', '直接／主ボタンの文言', '小ボタン（木・暗地）'),
]

tb = []
for name, ka, kb in PAIRS:
    a, b = by[ka], by[kb]
    tb.append(
        '<tr><td>%s</td>'
        '<td class="n">%.1f / %.1fpx</td>'
        '<td><span class="sw" style="background:%s"></span>%s</td>'
        '<td><span class="sw" style="background:%s"></span>%s</td>'
        '<td class="n ng">%.2f:1</td><td class="n ng">%d</td>'
        '<td><span class="sw" style="background:%s"></span>%s</td>'
        '<td class="n ok">%.2f:1</td><td class="n ok">%d</td>'
        '<td class="n">×%.1f</td></tr>'
        % (name, a['size'], b['size'], a['color'], a['color'], a['bg'], a['bg'], a['wcag'], a['dluma'],
           b['bg'], b['bg'], b['wcag'], b['dluma'], b['wcag'] / a['wcag']))

head = ('<thead><tr><th rowspan="2">役割</th><th rowspan="2">字送り A/B</th>'
        '<th colspan="4">A ── 絵に直接（影あり）</th><th colspan="3">B ── 部品の上（影なし）</th>'
        '<th rowspan="2">読みの差</th></tr>'
        '<tr><th>文字色</th><th>実際の地</th><th>WCAG</th><th>Δluma</th>'
        '<th>実際の地</th><th>WCAG</th><th>Δluma</th></tr></thead>')

na = sum(1 for _, ka, _ in PAIRS if not by[ka]['ok'])
nb = sum(1 for _, _, kb in PAIRS if by[kb]['ok'])
foot = (
    '<div class="verdict" style="width:1090px;margin-top:14px">'
    '<b>同じ文言・同じ絵で、地の作り方だけを変えて測った結果</b>　── '
    'A（絵に直接・影あり）は %d/%d 箇所が合格線（4.5:1）を割り、最悪は <span class="num">%.2f:1</span>。'
    'B（部品の上・影なし）は %d/%d 箇所すべて合格で、最小でも <span class="num">%.2f:1</span>。<br>'
    'しかも A には<b>影のぶんの下駄を履かせている</b>── 地を測った「文字だけを消したPNG」でも text-shadow は残って地を暗くするので、'
    'この A の数字は実際よりも良い側に出ている。それでもこの差になる。<br>'
    '<b>チープに見えるのは絵のせいではない。</b>絵は同じで、変えたのは「文字が自分の地を持つかどうか」だけ。'
    '</div>'
    % (na, len(PAIRS), min(by[ka]['wcag'] for _, ka, _ in PAIRS),
       nb, len(PAIRS), min(by[kb]['wcag'] for _, _, kb in PAIRS)))

p = V6 + 'proof_text.html'
s = io.open(p, encoding='utf-8').read()
h, rest = s.split('<thead>', 1)
_, rest2 = rest.split('</thead>', 1)
s = h + head + rest2
h, rest = s.split('<tbody id="cmp">', 1)
_, rest2 = rest.split('</tbody>', 1)
s = h + '<tbody id="cmp">\n' + '\n'.join(tb) + '\n</tbody>' + rest2
s = s.replace('<div class="numbers" style="width:814px">', '<div class="numbers" style="width:1090px">')
if 'class="verdict"' not in s:
    s = s.replace('</tbody></table></div>', '</tbody></table></div>\n' + foot, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('patched proof_text', len(s), 'verdict included:', foot[:20] in s)
