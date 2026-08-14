# -*- coding: utf-8 -*-
"""mock_v6.html から「サイズ検証用」「最長文検証用」のページを生成する。
   mock_v6.html 自体は書き換えない（部品CSSと画面マークアップを取り出して使う）。"""
import re, io, os, json

V6 = r'C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/mockups/v6'
SRC = os.path.join(V6, 'mock_v6.html')
src = io.open(SRC, encoding='utf-8').read()

# ---- 部品CSS / SVG定義 / 画面マークアップ / 盤の組み立てスクリプト を取り出す ----
style = src.split('<style>', 1)[1].split('</style>', 1)[0]
svgdefs = '<svg width="0" height="0"' + src.split('<svg width="0" height="0"', 1)[1].split('</svg>', 1)[0] + '</svg>'
hpstyle = src.split('/* HPピップ（遭遇の帯） */', 1)[1].split('</style>', 1)[0]

def take_phone(s, start):
    i = s.index('<div class="phone">', start)
    depth = 0; j = i
    while True:
        o = s.find('<div', j + 1); c = s.find('</div>', j + 1)
        if c == -1: raise SystemExit('unbalanced')
        if o != -1 and o < c:
            depth += 1; j = o
        else:
            if depth == 0: return s[i:c + 6], c + 6
            depth -= 1; j = c

phones = []; pos = 0
for _ in range(4):
    p, pos = take_phone(src, pos); phones.append(p)

# プレイ画面の盤は元は絶対配置（top:340px 固定）。可変にするため、その inline 指定だけ外す
phones[0] = phones[0].replace('<div class="blockrow" style="position:absolute;left:14px;right:14px;top:340px">',
                              '<div class="blockrow">')
assert 'position:absolute;left:14px' not in phones[0], 'blockrow の inline 指定を外せていない'

# 盤の組み立て（LAYOUT〜omen配置）だけを取り出し、CELL を可変にする
bs = src.split("const LAYOUT=[", 1)[1].split("/* ── 実測の下ごしらえ", 1)[0]
board_js = "const LAYOUT=[" + bs

SIZES = [(375, 667, 'iPhone SE / 8'), (390, 844, 'iPhone 12〜15'), (430, 932, 'iPhone 15 Pro Max')]
CAPS = [('01', 'プレイ'), ('02', '採録'), ('03', '祝福と呪い'), ('04', 'タイトル')]

RESPONSIVE = r"""
/* ============================================================
   可変レイヤー ── 端末サイズが変わっても部品は同じまま、置き方だけが変わる
   ・.phone の寸法は変数
   ・プレイ：縦フレックス。盤は余白ぶんだけ伸縮し、セル寸法は幅と高さの小さい方から決まる
   ・採録/祝福：縦フレックス。カード束は自然高、確定ボタンは下端へ寄る
   ・高さ 760px 未満は「詰めた密度」（余白と段差だけを縮める。文字サイズは変えない）
   ============================================================ */
.phone{width:var(--pw);height:var(--ph)}
.strip{display:flex;gap:26px;align-items:flex-start}
.unit2{width:var(--pw)}
.cap2{margin-bottom:10px;height:40px}
.cap2 .no{font-family:var(--num);font-weight:700;font-size:10px;letter-spacing:.16em;color:#B99A5E}
.cap2 h3{font-family:var(--min);font-weight:600;font-size:14px;margin:2px 0 0;letter-spacing:.06em;color:#F1E4C6}

.ui--play,.ui--deck{display:flex;flex-direction:column}
.ui--play .blockrow{position:static;flex:1 1 0;min-height:0;align-items:flex-end;margin-top:10px}
.ui--play .gauge{align-self:flex-end}
.ui--play .dock{position:static;left:auto;right:auto;bottom:auto;flex:0 0 auto;margin-top:14px}
.ui--deck .cards-tall{flex:0 0 auto}
.ui--deck .dock{position:static;left:auto;right:auto;bottom:auto;margin-top:auto;padding-top:12px}

/* 詰めた密度（高さ760px未満）── 縮めるのは余白・段差だけ。文字サイズには一切触れない。
   さらに2つだけ内容の出し方を変える：課目行の補助文を畳む／カード束の行間を詰める。 */
.phone.tight .ui{padding:10px}
.phone.tight .card__in{padding:10px 12px 10px}
.phone.tight .cards-tall .card__in{padding-top:7px;padding-bottom:7px}
.phone.tight .card__hd{margin-bottom:4px}
.phone.tight .chip--sm{padding:1px 8px 2px 6px}
.phone.tight .card__roundel{width:40px;height:40px;margin:-14px 0 0 -5px}
.phone.tight .card__roundel svg{width:21px;height:21px}
.phone.tight .card__ft{margin-top:4px;padding-top:4px}
.phone.tight .cards-tall > .card + .card{margin-top:5px !important}
.phone.tight .cards-tall{margin-top:8px !important}
.phone.tight .bless + .bless{margin-top:6px;padding-top:6px}
.phone.tight .card__body,.phone.tight .bless__tx{line-height:1.66}
.phone.tight .btn--lg{min-height:46px;font-size:17px}
.phone.tight .btn--sm{min-height:31px}
.phone.tight .panel__bd{padding:7px 12px 8px}
.phone.tight .panel__hd{padding-top:5px;padding-bottom:5px}
.phone.tight .row{padding-top:6px;padding-bottom:6px}
.phone.tight .ftbtns{margin-top:6px}
.phone.tight .ui--deck .dock{padding-top:6px}
/* 小さい端末では課目を「縦2段」から「横2枠」へ畳む（補助文は長押しへ）。盤に高さを返すため。
   ── これは現行実機（assets_src/r1_floor5.png）が既に採っている置き方でもある */
.phone.tight .ui--play .row__sub{display:none}
.phone.tight .ui--play .list{display:flex}
.phone.tight .ui--play .row{flex:1 1 0;min-width:0;gap:8px;padding:6px 8px;
  border-bottom:0;border-right:1px solid rgba(47,41,34,.17)}
.phone.tight .ui--play .row:last-child{border-right:0}
.phone.tight .ui--play .row__name{white-space:nowrap}
.phone.tight .ui--play .row__ic{width:30px;height:30px}
.phone.tight .ui--play .dock .panel__bd{padding:9px 10px 10px}
/* 端末の縁ぎりぎりに出る押印は、詰めた密度では内側へ寄せる */
.phone.tight .card__seal{right:-2px;top:-9px;width:42px;height:42px;font-size:14px}
.phone.tight .bless + .bless{margin-top:5px;padding-top:5px}
.phone.tight .med{min-width:58px;height:58px}
.phone.tight .med__well{min-width:40px;height:40px}
.phone.tight .med__n{font-size:20px}
.phone.tight .num--l{font-size:34px}
.phone.tight .logo .l1,.phone.tight .logo .l2{font-size:36px}

/* 盤の中身は1セルの大きさに追従する（駒・にじみ・環） */
.phone[data-kind=play]{--cell:39px}
.cell svg{width:calc(var(--cell)*.77);height:calc(var(--cell)*.77)}
.cell::after{width:calc(var(--cell)*.85);height:calc(var(--cell)*.85)}
.cell.sp::before{width:calc(var(--cell)*.87);height:calc(var(--cell)*.87)}
.cell.hot::before{width:calc(var(--cell)*.92);height:calc(var(--cell)*.92)}
"""

LAYOUT_JS = r"""
/* 画面ごとの置き方を決める（部品には触れない） */
const PH=[...document.querySelectorAll('.phone')];
PH.forEach(p=>{
  const ui=p.querySelector('.ui');
  if(p.dataset.kind==='play') ui.classList.add('ui--play');
  if(p.dataset.kind==='deck') ui.classList.add('ui--deck');
});
/* 盤：使える箱から1セルの大きさを決める（幅と高さの小さい方）。実装でも同じ式で足りる */
function layoutBoards(){
  document.querySelectorAll('.phone[data-kind=play]').forEach(p=>{
    const row=p.querySelector('.blockrow'), b=row.getBoundingClientRect();
    const gauge=p.querySelector('.gauge'), board=p.querySelector('.board');
    const gw=parseFloat(getComputedStyle(gauge).getPropertyValue('--w'))||30;
    const cw=(b.width-gw-6-14)/8, ch=(b.height-14)/8;
    const cell=Math.floor(Math.min(cw,ch)*4)/4;
    p.style.setProperty('--cell',cell+'px');
    const g=p.querySelector('.grid');
    g.style.gridTemplateColumns='repeat(8,'+cell+'px)';
    g.style.gridTemplateRows='repeat(8,'+cell+'px)';
    gauge.style.setProperty('--h',(cell*8+14)+'px');
    board.querySelectorAll('.tele,.beast,.omen').forEach(el=>{
      const d=el.dataset;
      el.style.left=(7+parseFloat(d.cx)*cell)+'px';
      el.style.top =(7+parseFloat(d.cy)*cell)+'px';
      if(d.cw){el.style.width=(parseFloat(d.cw)*cell)+'px';el.style.height=(parseFloat(d.ch)*cell)+'px';}
    });
  });
}
"""

AUDIT_JS = src.split('/* ── 実測の下ごしらえ', 1)[1]
AUDIT_JS = '/* ── 実測の下ごしらえ' + AUDIT_JS.split('</script>', 1)[0]

STRESS_JS = r"""
/* ============================================================
   最長文の差し込み。文言は src/core/{upgrades,blessings,floors}.ts の実データの最長を使う。
   （※カードの「本文最長」と「おまけ最長」は実データでは同じ知見に同居しないが、
     部品の最悪ケースを見るために意図的に同居させている＝下の caption に明記）
   ============================================================ */
const S=(sel,txt,root)=>{const e=(root||document).querySelector(sel); if(e)e.textContent=txt;};
const A=(l,txt,root)=>S('[data-a="'+l+'"]',txt,root);
document.querySelectorAll('.phone[data-kind=play]').forEach(p=>{
  A('メダリオン数値（深度）','10',p);
  S('.chip--act','第三幕',p);
  A('残灯の数値（大・暗地の札）','107',p);
  A('見出し帯・補助','ひかり苔の回廊 ／ 深度 10',p);
  const rows=p.querySelectorAll('.row');
  A('課目の名前','陶片の回収',rows[0]);
  A('課目の補助文','匣を割って中の陶片を集める。割るだけでは進まない',rows[0]);
  A('課目の残数（中）','7',rows[0]);
  S('.row__name','植物標本',rows[1]);
  S('.row__sub','葉と茸のどちらでも進む。爆発で消えた分も数える',rows[1]);
  S('.num--m','50',rows[1]);
  A('原生種の名前（盤上・暗地）','小型胞子虫',p);
  const oc=p.querySelector('.omen .chip--omen'); if(oc)oc.innerHTML='捕食印 <span class="n">3</span>';
  A('崩落予告の残り手','3',p);
});
const CARDS=[
 {kind:'知見 ・ 植物',name:'菌糸の目覚め',body:'植物マッチ時、マッチ跡地の近くに植物が生える（マッチが繋がる位置を優先。列詰め前に発生）',
  starter:'おまけ: 原生種のとなりに胞子を1つ置く',ko:'3'},
 {kind:'知見 ・ 遺物',name:'変換炉',body:'遺物マッチのとき、跡地の近くの駒1つが盤面で最も多い色に変わる（マッチが繋がる位置を優先）',
  starter:'おまけ: 充填済みギアを1つ置く',ko:'2'},
 {kind:'知見 ・ 植物',name:'深呼吸',body:'キノコを消すと、跡地の近くの1つが植物に変わる（マッチが繋がる位置を優先）',
  starter:'おまけ: 鉱物のとなりに胞子を1つ置く',ko:'0'},
];
const BLESS=[
 {name:'底ゆきの勘',boon:'深度5から下では層を出るときの補給が4ふえる',curse:'深度4までは層を出るときの補給が4へる'},
 {name:'一意専心',boon:'課目が1つだけの層は要求が4分の3になる',curse:'課目が2つある層は要求が4分の5になる'},
 {name:'息を殺す',boon:'灯喰み・深匣主に奪われる灯が 3 から 1 になる',curse:'灯が8へる'},
];
document.querySelectorAll('.phone[data-kind=deck]').forEach(p=>{
  const cards=[...p.querySelectorAll('.card')];
  const isBless=!!p.querySelector('.bless');
  cards.forEach((c,i)=>{
    if(isBless){
      const d=BLESS[i];
      c.querySelector('.card__name').textContent=d.name;
      const tx=c.querySelectorAll('.bless__tx');
      tx[0].textContent=d.boon; tx[1].textContent=d.curse;
    }else{
      const d=CARDS[i];
      c.querySelector('.card__kind').textContent=d.kind;
      c.querySelector('.card__name').textContent=d.name;
      c.querySelector('.card__body').innerHTML=d.body;
      c.querySelector('.card__starter').textContent=d.starter;
      c.querySelector('.chip--sm').innerHTML='呼応 <span class="n">'+d.ko+'</span>';
    }
  });
  const main=p.querySelector('.btn--lg .txt');
  if(isBless&&main)main.textContent='この祝福を受けて 深度 100 へ';
  const sub=p.querySelector('.panel__hd .sub'); if(sub)sub.textContent='深度 100 踏破';
});
document.querySelectorAll('.phone[data-kind=title]').forEach(p=>{
  A('最深記録の数値','100',p);
});
"""

def build(path, sizes, stress, title):
    units = []
    for (w, h, label) in sizes:
        for i, ph in enumerate(phones):
            kind = ['play', 'deck', 'deck', 'title'][i]
            p = ph.replace('<div class="phone">',
                           '<div class="phone%s" data-kind="%s" style="--pw:%dpx;--ph:%dpx">'
                           % (' tight' if h < 760 else '', kind, w, h), 1)
            # 盤の重ね物はセル座標で持たせる（サイズが変わっても同じ場所に落ちる）
            units.append(
                '<div class="unit2" style="--pw:%dpx"><div class="cap2"><span class="no">%s ／ %d×%d</span>'
                '<h3>%s</h3></div>%s</div>' % (w, CAPS[i][0], w, h, CAPS[i][1], p))
    body = '\n'.join(units)
    html = u"""<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>%s</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@600;700&family=Zen+Kaku+Gothic+New:wght@400;500;700&family=Archivo:wght@500;600;700&display=swap" rel="stylesheet">
<style>%s</style><style>%s</style><style>%s</style>
<style>.sheet{width:auto;padding:26px 26px 34px}</style>
</head><body>
%s
<div class="sheet"><div class="strip">
%s
</div></div>
<script>
%s
%s
layoutBoards();
%s
%s
</script>
</body></html>""" % (title, style, hpstyle, RESPONSIVE, svgdefs, body,
                      board_js.replace('const CELL=39;', 'const CELL=39;'),
                      LAYOUT_JS, STRESS_JS if stress else '', AUDIT_JS)
    io.open(path, 'w', encoding='utf-8').write(html)
    print('wrote', path, len(html))

# 盤スクリプトは phone ごとに動く必要があるので、id 参照 → セレクタ参照へ書き換える
board_js = board_js.replace("document.getElementById('grid')", "document.querySelector('.phone[data-kind=play] .grid')")
board_js = board_js.replace("document.getElementById('board')", "document.querySelector('.phone[data-kind=play] .board')")
# 盤の重ね物（崩落予告・原生種・兆候）はセル座標を持たせ、セル寸法が変わっても同じマスに落ちるようにする
board_js = board_js.replace(
    "function place(el,x,y,w,h){",
    "function place(el,x,y,w,h){el.dataset.cx=x;el.dataset.cy=y;el.dataset.cw=w;el.dataset.ch=h;")
board_js = board_js.replace(
    "omen.style.left=(7+2.55*CELL)+'px'; omen.style.top=(7+2.16*CELL)+'px';",
    "omen.dataset.cx=2.55;omen.dataset.cy=2.16;omen.style.left=(7+2.55*CELL)+'px';omen.style.top=(7+2.16*CELL)+'px';")

if __name__ == '__main__':
    for (w, h, lab) in SIZES:
        build(os.path.join(V6, 'shot_%dx%d.html' % (w, h)), [(w, h, lab)], False, 'yacho v6 %dx%d' % (w, h))
        build(os.path.join(V6, 'stress_%dx%d.html' % (w, h)), [(w, h, lab)], True, 'yacho v6 stress %dx%d' % (w, h))
