# -*- coding: utf-8 -*-
"""proof_text.html（絵に直接 対 部品の上）と proof_compare.html（現行実機 対 v6）を組む。
   文字はすべて HTML テキスト。左右で文言・字送り・書体は同一にして、地の作り方だけを変える。"""
import io, os, re

V6 = r'C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/mockups/v6'
src = io.open(os.path.join(V6, 'mock_v6.html'), encoding='utf-8').read()
style = src.split('<style>', 1)[1].split('</style>', 1)[0]
svgdefs = '<svg width="0" height="0"' + src.split('<svg width="0" height="0"', 1)[1].split('</svg>', 1)[0] + '</svg>'
hpstyle = src.split('/* HPピップ（遭遇の帯） */', 1)[1].split('</style>', 1)[0]


def take_phone(s, start):
    i = s.index('<div class="phone">', start)
    depth = 0; j = i
    while True:
        o = s.find('<div', j + 1); c = s.find('</div>', j + 1)
        if o != -1 and o < c:
            depth += 1; j = o
        else:
            if depth == 0: return s[i:c + 6], c + 6
            depth -= 1; j = c


play, _ = take_phone(src, 0)
board_js = 'const LAYOUT=[' + src.split('const LAYOUT=[', 1)[1].split('/* ── 実測の下ごしらえ', 1)[0]

HEAD = u"""<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>%s</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@600;700&family=Zen+Kaku+Gothic+New:wght@400;500;700&family=Archivo:wght@500;600;700&display=swap" rel="stylesheet">
<style>%s</style><style>%s</style>
<style>
.sheet{width:auto;padding:30px 30px 36px}
.pair{display:flex;gap:34px;align-items:flex-start}
.col{width:390px}
.col h3{font-family:var(--min);font-weight:600;font-size:17px;margin:0 0 3px;letter-spacing:.07em}
.col .lead{font-size:11.5px;line-height:1.8;color:#B7A98C;margin:0 0 12px;height:56px}
.col h3.bad{color:#E0A692}.col h3.good{color:#9FC1A4}
.numbers{margin-top:14px;background:rgba(241,231,209,.94);border-radius:3px;overflow:hidden}
.numbers table{width:100%%;border-collapse:collapse;font-size:11.5px;color:var(--ink-text)}
.numbers th,.numbers td{padding:5px 8px;border-bottom:1px solid rgba(47,41,34,.18);text-align:left}
.numbers th{font-family:var(--num);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-soft);
  background:rgba(214,199,168,.72)}
.numbers td.n{font-family:var(--num);font-weight:600;text-align:right;font-variant-numeric:tabular-nums}
.numbers .ng{color:#8E3A29;font-weight:700}.numbers .ok{color:#2F5A3C;font-weight:700}
/* ── 左：絵に直接文字を置いた場合（v5 のやり方）。札を敷かず、影で読ませようとする ── */
.raw{position:absolute;inset:0;padding:14px;color:#F1E4C6;
  text-shadow:0 1px 2px rgba(20,14,10,.75), 0 2px 8px rgba(20,14,10,.55)}
.raw .r-hd{display:flex;align-items:baseline;gap:10px}
.raw .k{font-family:var(--min);font-weight:600;font-size:12.5px;letter-spacing:.12em}
.raw .big{font-family:var(--num);font-weight:600;font-size:40px;line-height:1}
.raw .med{font-family:var(--num);font-weight:600;font-size:23px;line-height:1}
.raw h4{font-family:var(--min);font-weight:600;font-size:15px;letter-spacing:.09em;margin:22px 0 10px}
.raw .g-name{font-family:var(--min);font-weight:600;font-size:14.5px;letter-spacing:.03em}
.raw .g-sub{font-size:11.5px;line-height:1.55;color:#E4D6B6;display:block;margin-top:2px}
.raw .g-val{font-family:var(--num);font-weight:600;font-size:21px}
.raw .grow{display:flex;align-items:center;gap:11px;margin-bottom:12px}
.raw .grow .sp{flex:1}
.raw .btm{position:absolute;left:14px;right:14px;bottom:16px}
.raw .btn-t{font-family:var(--min);font-weight:600;font-size:15.5px;letter-spacing:.1em;text-align:center;
  display:block;padding:12px 0}
</style></head><body>
%s
<div class="sheet">
"""

# ---------------- proof_text ----------------
RAW = u"""
<div class="phone">
  <div class="bg" style="background-image:url('scene_play.jpg');background-size:auto 240%;background-position:58% 0%"></div>
  <div class="scrim" style="background:linear-gradient(180deg,rgba(24,19,14,.10) 0%,rgba(24,19,14,.18) 60%,rgba(24,19,14,.34) 100%)"></div>
  <div class="raw">
    <div class="r-hd">
      <span class="k" data-a="直接／深度の見出し語">深度</span><span class="med" data-a="直接／深度の数値">5</span>
      <span style="flex:1"></span>
      <span class="k" data-a="直接／残灯の見出し語">残灯</span><span class="big" data-a="直接／残灯の数値">66</span>
    </div>
    <h4 data-a="直接／課目の見出し">本層の課目</h4>
    <div class="grow">
      <span style="flex:1">
        <span class="g-name" data-a="直接／課目の名前">掃討</span>
        <span class="g-sub" data-a="直接／課目の補助文">裂坑掘り 1体。倒すまで層は明けない</span>
      </span>
      <span class="g-val" data-a="直接／課目の残数">1</span>
    </div>
    <div class="grow">
      <span style="flex:1">
        <span class="g-name">植物標本</span>
        <span class="g-sub">葉と茸のどちらでも進む</span>
      </span>
      <span class="g-val">41</span>
    </div>
    <div class="btm">
      <span class="btn-t" data-a="直接／主ボタンの文言">採録帖をひらく</span>
    </div>
  </div>
</div>
"""

def build_text():
    body = u"""
<header class="doc-hd">
  <div style="flex:0 0 auto"><div class="kv">yacho / mockups / v6 / proof</div>
  <h1>絵に直接 対 部品の上</h1></div>
  <p><b>同じ文言・同じ書体・同じ字送りを、同じ絵の上に置いた2枚。</b>ちがうのは「地の作り方」だけ。
  左は札を敷かず、影（text-shadow）で読ませようとしたもの＝v5 の作り方。
  右は v6＝文字が自分の不透明な地（帯・紙・札）を持ち、<b>影も縁取りも使っていない</b>。
  下の数字は、どちらも<b>同じ手順で描画画素から測った</b>実測値。</p>
</header>
<div class="pair">
  <div class="col">
    <h3 class="bad">A ── 絵に直接置く（影で読ませる）</h3>
    <p class="lead">絵は生きるが、文字の地は絵の都合で決まる。連鎖や崩落で絵が動けば、同じ文字の読みやすさも動く。
      影を足すほど、文字は絵から浮いて「後から貼った」ように見える。</p>
    %s
  </div>
  <div class="col">
    <h3 class="good">B ── 部品の上に置く（v6）</h3>
    <p class="lead">絵は情景として残し、文字は自分の地の上にだけ載る。地は絵と無関係に決まるので、
      どの層・どの明るさでも読みは変わらない。影も縁取りも要らない。</p>
    %s
  </div>
</div>
<div class="numbers" style="width:814px"><table>
<thead><tr><th>役割</th><th>字送り</th><th>A 文字色</th><th>A 実際の地</th><th>A WCAG</th><th>A Δluma</th>
<th>B WCAG</th><th>B Δluma</th><th>差</th></tr></thead>
<tbody id="cmp"><tr><td colspan="9">（実測して差し替える）</td></tr></tbody></table></div>
""" % (RAW, play)
    html = (HEAD % ('proof_text', style, hpstyle, svgdefs)) + body + u"""
</div>
<style>%s</style>
<script>
%s
</script>
</body></html>""" % (hpstyle, board_js)
    io.open(os.path.join(V6, 'proof_text.html'), 'w', encoding='utf-8').write(html)
    print('proof_text.html')


# ---------------- proof_compare ----------------
def build_compare():
    body = u"""
<header class="doc-hd">
  <div style="flex:0 0 auto"><div class="kv">yacho / mockups / v6 / proof</div>
  <h1>現行実機 対 v6</h1></div>
  <p>左は<b>いま動いている実機</b>（assets_src/r1_floor5.png ／ 深度5・390×844）。右は v6 の同じ層。
  比べるのは絵の巧拙ではなく<b>構造</b>── 見出し帯があるか、同型の部品が反復しているか、数値が読める地に載っているか、
  そして<b>絵がUIを兼ねていないか</b>。</p>
</header>
<div class="pair">
  <div class="col">
    <h3 class="bad">現行 ── 深度5</h3>
    <p class="lead">現行も札は持っている（真鍮のゲージ・羊皮紙のカプセル）。ちがうのは<b>部品どうしが同じ文法で作られていない</b>こと。
      見出し帯が無く、要素ごとに縁・角丸・地がちがう。駒は彩度と艶の強い別筆で、盤も暗いため焦点が決まらない。</p>
    <div class="phone"><img src="r1_floor5.png" style="width:390px;height:844px;display:block"></div>
  </div>
  <div class="col">
    <h3 class="good">v6 ── 同じ深度5</h3>
    <p class="lead">見出し帯・同型の行・同じ角丸と縁で組み直したもの。情景は上半分に残し、
      盤と札で下半分を覆う。文字はすべて自分の地の上にある。</p>
    %s
  </div>
</div>
""" % play
    html = (HEAD % ('proof_compare', style, hpstyle, svgdefs)) + body + u"""
</div>
<style>%s</style>
<script>
%s
</script>
</body></html>""" % (hpstyle, board_js)
    io.open(os.path.join(V6, 'proof_compare.html'), 'w', encoding='utf-8').write(html)
    print('proof_compare.html')


if __name__ == '__main__':
    build_text()
    build_compare()
