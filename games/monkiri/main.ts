// games/monkiri/main.ts — 紋切り 江戸の紙遊び（Playlab No.11）
import { Paper, makeTarget, renderCrest, SIZE } from './paper'
import type { Fragment } from './paper'
import { LEVELS, FOLD_LABEL } from './levels'
import { attachPointer, fitCanvas, safeBottom } from '../../shared/input'
import { hexA } from '../../shared/theme'
import { mountMuteButton } from '../../shared/audio'
import * as tune from '../../shared/tune'
import { drawExpLabel } from '../../shared/shell'
import { enterTransition, wireLink } from '../../shared/transition'
import * as snd from './sound'

// ── 定数 ──────────────────────────────────────────────────────────────
const FS = '"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif'
const FSS = '"Hiragino Sans","Yu Gothic",sans-serif'
const C_MAT    = '#324538'
const C_PAPER  = '#f6f1e3'
const C_VRM    = '#b5432c'   // 朱
const C_VRM_L  = '#c8503a'   // 明るい朱（ガイド）
const C_INK    = '#332e24'   // 墨
const C_MATTXT = '#ece5d2'   // マット上テキスト
const C_MUTED  = 'rgba(236,229,210,0.55)'
const C_IND    = '#2f4a6b'   // 藍（雪判子）
const C_SH1    = '#e7dfc9'
const C_SH2    = '#dbd2b8'
const KANJI    = ['一','二','三','四','五','六','七','八','九','十','十一','十二']
const RANK_CH  = ['','梅','竹','松','雪']
const RANK_COL = ['', C_VRM, C_VRM, C_VRM, C_IND]

// ── URLパラメータ ──────────────────────────────────────────────────────
const Q    = new URLSearchParams(location.search)
const SHOT = Q.get('shot')
const SW   = parseInt(Q.get('w') || '0') || 0
const SH   = parseInt(Q.get('h') || '0') || 0

if (SHOT && SW && SH) {
  document.documentElement.style.cssText = `width:${SW}px;height:${SH}px;position:fixed;inset:0;overflow:hidden;`
  document.body.style.cssText = `width:${SW}px;height:${SH}px;position:fixed;left:0;top:0;overflow:hidden;`
}

// ── canvas ──────────────────────────────────────────────────────────
const canvas = document.getElementById('game') as HTMLCanvasElement
const ctx    = canvas.getContext('2d')!

if (SHOT && SW && SH) {
  canvas.style.cssText = `position:fixed;left:0;top:0;width:${SW}px;height:${SH}px;`
}

// ── サイズ（fitCanvas 前に宣言 — TDZ対策） ──────────────────────────
let W = 390
let H = 844

// ── ポインタ（fitCanvas 前に宣言） ──────────────────────────────────
const ptrh = attachPointer(canvas)
const ptr  = ptrh.pointer

// ── state ──────────────────────────────────────────────────────────
type Scene = 'title'|'techo'|'play'|'opening'|'result'|'free'|'free_play'|'free_opening'|'free_result'|'targets'
let scene: Scene = 'title'
let levelIdx   = 0
let freeN      = 2  // 自由切りの折り数（1〜4）
let paper      = new Paper(LEVELS[0].N)
let freePaper  = new Paper(2)

// ── タイトルデモ ────────────────────────────────────────────────────
let demoTarget: Paper | null = null
let demoCopies = 0
let demoPhase  = 0  // 0=opening, 1=hold, 2=fade
let demoPhaseT = 0
const DEMO_OPEN_DUR = 1.2
const DEMO_HOLD_DUR = 2.3
const DEMO_FADE_DUR = 0.5

// ── 開き演出 ────────────────────────────────────────────────────────
let openTimer  = 0
let openPhase  = 0   // 0=lift, 1=unfold, 2=done
let openCopies = 0
let prevFloor  = 0   // unfoldTick 用
let simScore   = 0
let simRank    = 0

// ── 結果サブ状態 ──────────────────────────────────────────────────
let resultT    = 0   // 結果画面に入ってからの時間
let stampFired = false
let shakeT     = 0
let shakeX     = 0
let shakeY     = 0
// (gallerySaved tracking removed — save happens once in setScene)

// ── 紙片パーティクル ──────────────────────────────────────────────
interface Particle {
  frag: Fragment; px: number; py: number
  vx: number; vy: number; rot: number; wobble: number; age: number
}
let particles: Particle[] = []
const PART_DUR = 1.4

// ── 切り操作 ─────────────────────────────────────────────────────
let cutting   = false
let cutPts: {x:number;y:number}[] = []
let snipAccum = 0
let lastSnipX = 0; let lastSnipY = 0

// ── ガイドオーバーレイ ───────────────────────────────────────────
let guideCanvas: HTMLCanvasElement | null = null
let guideDirty = true

// ── はじめから2度押し ─────────────────────────────────────────────
let resetConfirmT = -999

// ── 紙の表示パラメータ（playとopeningで共有） ────────────────────
let playAx = 0; let playAy = 0; let playS = 1
// opening lift start position
let liftFromAy = 0

// ── 手本カード拡大オーバーレイ ──────────────────────────────────
let hintOpen = false

// ── キャッシュ ─────────────────────────────────────────────────
const targetMap  = new Map<number, Paper>()
const crestMap   = new Map<string, HTMLCanvasElement>()

function getTarget(idx: number): Paper {
  if (!targetMap.has(idx)) {
    const lv = LEVELS[idx]
    targetMap.set(idx, makeTarget(lv.N, lv.cuts))
  }
  return targetMap.get(idx)!
}

function getCrest(key: string, p: Paper, size: number, color: string): HTMLCanvasElement {
  const k = `${key}_${size}_${color}`
  if (!crestMap.has(k)) crestMap.set(k, renderCrest(p, size, color))
  return crestMap.get(k)!
}

// ── 保存 ───────────────────────────────────────────────────────
const SAVE_KEY = 'playlab.monkiri.v1'
interface SaveData { ranks: Record<string,number>; gallery: string[] }
let save: SaveData = { ranks:{}, gallery:[] }
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (raw) { const d = JSON.parse(raw); if(d.ranks) save.ranks=d.ranks; if(d.gallery) save.gallery=d.gallery }
  } catch {}
}
function writeSave() { try { localStorage.setItem(SAVE_KEY,JSON.stringify(save)) } catch {} }
loadSave()

function getRank(id: string): number { return save.ranks[id] ?? 0 }
function setRank(id: string, r: number) {
  if (r > getRank(id)) { save.ranks[id] = r; writeSave() }
}

function isUnlocked(idx: number, override=false): boolean {
  if (override || SHOT==='techo') return true
  if (idx === 0) return true
  return getRank(LEVELS[idx-1].id) >= 1
}

// ── tune ────────────────────────────────────────────────────────
const P = tune.panel('monkiri', {
  UME:     { v:0.70, min:0.4, max:0.9,  step:0.01,  group:'判定' },
  TAKE:    { v:0.82, min:0.4, max:0.9,  step:0.01,  group:'判定' },
  MATSU:   { v:0.90, min:0.4, max:0.97, step:0.01,  group:'判定' },
  YUKI:    { v:0.965,min:0.9, max:1,    step:0.005, group:'判定' },
  FALL_G:  { v:620,  min:200, max:1200, step:20,    group:'演出' },
  OPEN_MS: { v:900,  min:400, max:2000, step:50,    group:'演出' },
}, { version:1 })

// ── ヘルパー ────────────────────────────────────────────────────
function clamp(v:number,lo:number,hi:number){ return v<lo?lo:v>hi?hi:v }
function lerp(a:number,b:number,t:number){ return a+(b-a)*t }
function easeOutCubic(t:number){ return 1-(1-t)**3 }
function easeInOut(t:number){ return t<0.5?2*t*t:1-(-2*t+2)**2/2 }

function rrect(cx2:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number){
  if((cx2 as any).roundRect){ cx2.beginPath();(cx2 as any).roundRect(x,y,w,h,r);return }
  cx2.beginPath()
  cx2.moveTo(x+r,y); cx2.arcTo(x+w,y,x+w,y+h,r); cx2.arcTo(x+w,y+h,x,y+h,r)
  cx2.arcTo(x,y+h,x,y,r); cx2.arcTo(x,y,x+w,y,r); cx2.closePath()
}

function hitRect(px:number,py:number,x:number,y:number,w:number,h:number){ return px>=x&&px<=x+w&&py>=y&&py<=y+h }

// ── マット背景 ─────────────────────────────────────────────────
function drawMat(){
  ctx.fillStyle = C_MAT
  ctx.fillRect(0,0,W,H)
  // 方眼
  ctx.strokeStyle='rgba(255,255,255,0.05)'; ctx.lineWidth=1; ctx.beginPath()
  const gs=34
  for(let x=0;x<W;x+=gs){ctx.moveTo(x+.5,0);ctx.lineTo(x+.5,H)}
  for(let y=0;y<H;y+=gs){ctx.moveTo(0,y+.5);ctx.lineTo(W,y+.5)}
  ctx.stroke()
  // 対角線
  ctx.strokeStyle='rgba(255,255,255,0.03)'; ctx.beginPath()
  const ds=60; const diag=Math.max(W,H)*2.5
  for(let i=-diag;i<W+diag;i+=ds){ctx.moveTo(i,0);ctx.lineTo(i+diag,diag)}
  ctx.stroke()
  // ヴィネット
  const vig=ctx.createRadialGradient(W/2,H/2,Math.min(W,H)*0.25,W/2,H/2,Math.max(W,H)*0.78)
  vig.addColorStop(0,'rgba(0,0,0,0)'); vig.addColorStop(1,'rgba(0,0,0,0.25)')
  ctx.fillStyle=vig; ctx.fillRect(0,0,W,H)
  // ルーラー
  drawRuler()
}

function drawRuler(){
  const x0=8
  ctx.strokeStyle='rgba(255,255,255,0.14)'; ctx.lineWidth=1
  ctx.fillStyle='rgba(255,255,255,0.14)'; ctx.font=`10px ${FS}`
  ctx.textAlign='left'; ctx.textBaseline='middle'
  ctx.beginPath()
  for(let y=0;y<H;y+=5){
    const maj=y%50===0
    ctx.moveTo(x0,y); ctx.lineTo(x0+(maj?8:4),y)
    if(maj&&y>0){ ctx.fillText(String(y),x0+10,y) }
  }
  ctx.stroke()
}

// ── 紙の表示変換パラメータを計算 ────────────────────────────────
function calcPaperTransform(p: Paper, topH: number, botH: number): {ax:number,ay:number,s:number} {
  const workH = H - topH - botH
  const maxW  = W - 48
  const sx    = maxW / (2 * p.R * Math.sin(p.halfAngle))
  const sy    = (workH - 30) / p.R
  const s     = Math.min(sx, sy, 1.2)
  const ax    = W / 2
  const ay    = topH + workH - 20
  return { ax, ay, s }
}

// ── 紙を描く（下敷き＋ドロップシャドウ込み） ─────────────────────
function drawPaperAtPos(p: Paper, ax: number, ay: number, s: number, alpha=1){
  ctx.save()
  ctx.globalAlpha = alpha
  // 下敷きシルエット（紙が2N枚重なっている感）
  for(const [dx,dy,col] of [[4,8,C_SH2],[2,5,C_SH1]] as [number,number,string][]){
    ctx.save()
    ctx.translate(ax+dx,ay+dy); ctx.rotate(-Math.PI/2); ctx.scale(s,s); ctx.translate(-p.apex.x,-p.apex.y)
    p.wedgePath(ctx); ctx.fillStyle=col; ctx.fill()
    ctx.restore()
  }
  // ドロップシャドウ付きで本体
  ctx.shadowColor='rgba(20,16,8,0.35)'; ctx.shadowBlur=18; ctx.shadowOffsetX=0; ctx.shadowOffsetY=6
  ctx.save()
  ctx.translate(ax,ay); ctx.rotate(-Math.PI/2); ctx.scale(s,s); ctx.translate(-p.apex.x,-p.apex.y)
  ctx.drawImage(p.canvas,0,0)
  ctx.restore()
  ctx.restore()
}

// ── ガイド生成 ────────────────────────────────────────────────
function buildGuide(p: Paper): HTMLCanvasElement {
  const lv = LEVELS[levelIdx]
  const gc = document.createElement('canvas')
  gc.width = gc.height = SIZE
  const gctx = gc.getContext('2d')!
  gctx.globalAlpha = 0.72
  gctx.strokeStyle = C_VRM_L
  gctx.lineWidth = 3
  gctx.setLineDash([7,5])
  gctx.lineCap = 'round'
  for(const cut of lv.cuts){ p.tracePath(gctx,cut); gctx.stroke() }
  gctx.globalCompositeOperation='destination-in'
  gctx.globalAlpha=1; gctx.setLineDash([])
  gctx.drawImage(p.canvas,0,0)
  return gc
}

// ── マスキングテープ風コーナー ────────────────────────────────
function drawTape(x:number,y:number,angle:number){
  ctx.save()
  ctx.translate(x,y); ctx.rotate(angle)
  ctx.fillStyle='rgba(214,196,150,0.5)'
  ctx.fillRect(-16,-5,32,10)
  ctx.restore()
}

// ── カード（手本帖の格子カード） ─────────────────────────────
function drawLevelCard(idx:number,cx:number,cy:number,cw:number,ch:number,overrideUnlock=false){
  const lv   = LEVELS[idx]
  const unlk = isUnlocked(idx,overrideUnlock)
  const rank = getRank(lv.id)
  // 影
  ctx.save()
  ctx.shadowColor='rgba(0,0,0,0.28)'; ctx.shadowBlur=8; ctx.shadowOffsetY=3
  rrect(ctx,cx,cy,cw,ch,8)
  ctx.fillStyle=C_PAPER; ctx.fill()
  ctx.restore()
  // マスキングテープ
  const off=cw*0.15
  drawTape(cx+off,cy,-0.15)
  drawTape(cx+cw-off,cy,0.12)
  // 紋
  const crestSz = Math.floor(cw * 0.68)
  const crestX  = cx + cw/2
  const crestY  = cy + ch * 0.48
  if(unlk){
    const tgt  = getTarget(idx)
    const img  = getCrest(`lv${idx}`,tgt,crestSz,C_INK)
    ctx.drawImage(img,crestX-crestSz/2,crestY-crestSz/2)
  } else {
    // 裏向き（無地＋結び紐ふう線）
    ctx.fillStyle=C_SH1; ctx.fillRect(cx+4,cy+4,cw-8,ch-8)
    ctx.strokeStyle=hexA(C_INK,0.25); ctx.lineWidth=1.5
    ctx.beginPath()
    const mx=cx+cw/2; const my=cy+ch*0.45; const rr=crestSz*0.15
    ctx.arc(mx,my,rr,0,Math.PI*2)
    ctx.moveTo(mx,my-rr); ctx.lineTo(mx,my-rr-8)
    ctx.moveTo(mx-4,my-rr-6); ctx.bezierCurveTo(mx,my-rr-14,mx,my-rr-14,mx+4,my-rr-6)
    ctx.stroke()
  }
  // 題名
  ctx.fillStyle = unlk ? C_INK : hexA(C_INK,0.25)
  ctx.font=`500 ${Math.floor(cw*0.11)}px ${FS}`
  ctx.textAlign='center'; ctx.textBaseline='alphabetic'
  const nameY = cy+ch-28
  ctx.fillText(unlk ? `${KANJI[idx]}　${lv.name}` : '─', cx+cw/2, nameY)
  // 折り数
  ctx.fillStyle = hexA(C_INK,0.35)
  ctx.font=`400 ${Math.floor(cw*0.09)}px ${FSS}`
  ctx.fillText(unlk ? FOLD_LABEL[lv.N] : '', cx+cw/2, nameY+15)
  // 判子（小）
  if(rank>0){
    drawStampMini(cx+cw-14,cy+14,rank,14)
  }
}

function drawStampMini(cx:number,cy:number,rank:number,r:number){
  ctx.save()
  ctx.translate(cx,cy); ctx.rotate(-8*Math.PI/180)
  // 印影：ベタの丸に白抜き文字
  ctx.globalAlpha*=0.92
  ctx.fillStyle=RANK_COL[rank]
  ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.fill()
  ctx.fillStyle=C_PAPER
  ctx.font=`600 ${Math.floor(r*1.15)}px ${FS}`
  ctx.textAlign='center'; ctx.textBaseline='middle'
  ctx.fillText(RANK_CH[rank],0,1)
  ctx.restore()
}

function drawStamp(cx:number,cy:number,rank:number,scale:number){
  const r=40
  ctx.save()
  ctx.translate(cx,cy); ctx.rotate(-8*Math.PI/180); ctx.scale(scale,scale)
  // 印影：ベタの丸に白抜き文字＋縁内の白罫。押し痕としてわずかに透ける
  ctx.globalAlpha*=0.93
  ctx.fillStyle=RANK_COL[rank]
  ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.fill()
  ctx.strokeStyle=hexA(C_PAPER,0.75); ctx.lineWidth=1.6
  ctx.setLineDash([11,2.5])
  ctx.beginPath(); ctx.arc(0,0,r-4.5,0,Math.PI*2); ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle=C_PAPER
  ctx.font=`700 42px ${FS}`
  ctx.textAlign='center'; ctx.textBaseline='middle'
  ctx.fillText(RANK_CH[rank],0,2)
  ctx.restore()
}

// ── ボタン（canvas描画・角丸・明朝） ─────────────────────────
function drawBtn(label:string,x:number,y:number,w:number,h:number,primary:boolean,dimmed=false){
  ctx.save()
  if(dimmed) ctx.globalAlpha=0.38
  rrect(ctx,x,y,w,h,8)
  if(primary){
    ctx.fillStyle=C_VRM; ctx.fill()
  } else {
    ctx.fillStyle=hexA('#f6f1e3',0.12); ctx.fill()
    ctx.strokeStyle=hexA(C_MATTXT,0.4); ctx.lineWidth=1; ctx.stroke()
  }
  ctx.fillStyle = primary ? C_PAPER : C_MATTXT
  ctx.font=`500 ${Math.floor(h*0.40)}px ${FS}`
  ctx.textAlign='center'; ctx.textBaseline='middle'
  ctx.fillText(label,x+w/2,y+h/2)
  ctx.restore()
}

// ──────────────────────────────────────────────────────────────────
// TITLE
// ──────────────────────────────────────────────────────────────────
function drawTitle(t:number){
  drawMat()
  // 中央カード（生成りの紙）
  const cw=Math.min(280,W-60); const ch=cw*1.1
  const cx=(W-cw)/2; const cy=H*0.18
  ctx.save()
  ctx.shadowColor='rgba(20,16,8,0.4)'; ctx.shadowBlur=22; ctx.shadowOffsetY=8
  rrect(ctx,cx,cy,cw,ch,6); ctx.fillStyle=C_PAPER; ctx.fill()
  ctx.restore()
  // テープ
  drawTape(cx+cw*0.2,cy,-0.1); drawTape(cx+cw*0.8,cy,0.14)
  // デモ紋（カード内・題字の上に約150pxで不透明に）
  if(demoTarget){
    const dR2=72
    const fadeAlpha=demoPhase===2?Math.max(0,1-demoPhaseT/DEMO_FADE_DUR):1
    ctx.save(); ctx.globalAlpha=fadeAlpha
    rrect(ctx,cx,cy,cw,ch,6); ctx.clip()
    // 紙×紙で霞まないよう、裁ち盤色の丸窓を下敷きにする
    ctx.fillStyle=C_MAT
    ctx.beginPath(); ctx.arc(cx+cw/2,cy+ch*0.30,dR2+9,0,Math.PI*2); ctx.fill()
    demoTarget.renderUnfolded(ctx,cx+cw/2,cy+ch*0.30,dR2,0,demoCopies)
    ctx.restore()
  }
  // 題名「紋切」
  ctx.textAlign='center'; ctx.textBaseline='alphabetic'
  ctx.fillStyle=C_INK
  ctx.font=`700 72px ${FS}`
  ctx.letterSpacing='0.05em'
  const titleY=cy+ch*0.78
  ctx.fillText('紋切',cx+cw/2,titleY)
  // サブタイトル
  ctx.fillStyle=C_VRM; ctx.font=`400 14px ${FS}`
  ctx.fillText('きって、ひらく。',cx+cw/2,titleY+26)
  // CTA（点滅）
  const pulse=SHOT?1:0.65+0.35*Math.sin(t*3.5)
  ctx.globalAlpha=pulse
  ctx.fillStyle=C_VRM; ctx.font=`500 16px ${FS}`
  ctx.fillText('たっぷ で はじめる',W/2,cy+ch+42)
  ctx.globalAlpha=1
  // フッター（EXPラベルと重ならない高さに）
  ctx.fillStyle=C_MUTED; ctx.font=`400 11px ${FSS}`
  ctx.fillText('江戸の紙遊び〈紋切り〉より　／　紋切り型、上等。',W/2,H-64-safeBottom())
  // EXPラベル
  drawExpLabel(ctx,W,H,'EXP-011','きって、ひらく。')
}

// ──────────────────────────────────────────────────────────────────
// TECHO（手本帖）
// ──────────────────────────────────────────────────────────────────
// 全体が H - safeBottom() - 24 に収まるレイアウト（描画とタップ判定で共有）
function techoLayout(){
  const sb=safeBottom()
  const margin=10; const gap=7; const cols=3; const rows=4
  const cw=Math.floor((W-margin*2-gap*(cols-1))/cols)
  const headerH=72
  const freeH=44
  const freeY=H-sb-24-freeH
  const availH=freeY-gap-headerH
  const ch=Math.floor((availH-gap*(rows-1))/rows)
  return { margin, gap, cols, cw, ch, headerH, freeH, freeY }
}

function drawTecho(){
  drawMat()
  // ヘッダ
  ctx.fillStyle=C_MATTXT; ctx.textAlign='center'; ctx.textBaseline='alphabetic'
  ctx.font=`700 24px ${FS}`
  ctx.fillText('手本帖',W/2,44)
  ctx.fillStyle=C_MUTED; ctx.font=`400 11px ${FSS}`
  ctx.fillText('てほんちょう',W/2,60)
  // カード格子 3×4
  const L=techoLayout()
  for(let i=0;i<12;i++){
    const col=i%L.cols; const row=Math.floor(i/L.cols)
    const cx=L.margin+col*(L.cw+L.gap)
    const cy=L.headerH+row*(L.ch+L.gap)
    drawLevelCard(i,cx,cy,L.cw,L.ch)
  }
  // 自由切りカード
  ctx.save()
  ctx.shadowColor='rgba(0,0,0,0.22)'; ctx.shadowBlur=6; ctx.shadowOffsetY=2
  rrect(ctx,L.margin,L.freeY,W-L.margin*2,L.freeH,8)
  ctx.fillStyle=C_PAPER; ctx.fill()
  ctx.restore()
  ctx.fillStyle=C_INK; ctx.font=`500 14px ${FS}`
  ctx.textAlign='center'; ctx.textBaseline='middle'
  ctx.fillText('白紙　──　じゆうに、きる',W/2,L.freeY+L.freeH/2)
}

// ──────────────────────────────────────────────────────────────────
// PLAY
// ──────────────────────────────────────────────────────────────────
function drawPlay(t:number){
  drawMat()
  const sb=safeBottom()
  const topH=58; const botH=76+sb
  const { ax, ay, s } = calcPaperTransform(paper, topH, botH)
  playAx=ax; playAy=ay; playS=s

  // ── 上部バー ──
  const lv=LEVELS[levelIdx]
  ctx.fillStyle=C_MATTXT; ctx.textAlign='left'; ctx.textBaseline='alphabetic'
  ctx.font=`700 16px ${FS}`
  ctx.fillText(`其の${KANJI[levelIdx]}　${lv.name}`,70,28)
  ctx.fillStyle=C_MUTED; ctx.font=`400 11px ${FSS}`
  ctx.fillText(`${FOLD_LABEL[lv.N]}　･　鋏 ${paper.cutCount}`,70,46)

  // 右上 手本カード(92px)
  const cc=92; const ccx=W-cc-8; const ccy=6
  ctx.save()
  ctx.shadowColor='rgba(0,0,0,0.22)'; ctx.shadowBlur=8; ctx.shadowOffsetY=2
  rrect(ctx,ccx,ccy,cc,cc,6); ctx.fillStyle=C_PAPER; ctx.fill()
  ctx.restore()
  drawTape(ccx+cc*0.25,ccy,-0.1); drawTape(ccx+cc*0.75,ccy,0.12)
  const tgt=getTarget(levelIdx)
  const cimg=getCrest(`lv${levelIdx}`,tgt,Math.floor(cc*0.72),C_INK)
  ctx.drawImage(cimg,ccx+(cc-cimg.width)/2,ccy+(cc-cimg.height)/2+2)

  // ── 紙（下敷き＋本体） ──
  drawPaperAtPos(paper,ax,ay,s)

  // ── ガイドオーバーレイ ──
  if(lv.guide){
    if(guideDirty||!guideCanvas){ guideCanvas=buildGuide(paper); guideDirty=false }
    ctx.save()
    ctx.translate(ax,ay); ctx.rotate(-Math.PI/2); ctx.scale(s,s); ctx.translate(-paper.apex.x,-paper.apex.y)
    ctx.drawImage(guideCanvas,0,0)
    ctx.restore()
  }

  // ── パーティクル ──
  drawParticles()

  // ── 切り線 ──
  if(cutting&&cutPts.length>1){
    ctx.save()
    ctx.strokeStyle='rgba(51,46,36,0.75)'; ctx.lineWidth=1.5; ctx.lineCap='round'
    ctx.beginPath()
    ctx.moveTo(cutPts[0].x,cutPts[0].y)
    for(let i=1;i<cutPts.length;i++) ctx.lineTo(cutPts[i].x,cutPts[i].y)
    ctx.stroke()
    // 刃先マーク
    const last=cutPts[cutPts.length-1]
    const prev=cutPts[Math.max(0,cutPts.length-3)]
    const angle=Math.atan2(last.y-prev.y,last.x-prev.x)
    ctx.save()
    ctx.translate(last.x,last.y); ctx.rotate(angle)
    ctx.fillStyle='rgba(51,46,36,0.65)'
    ctx.beginPath(); ctx.moveTo(6,0); ctx.lineTo(-3,-3); ctx.lineTo(-3,3); ctx.closePath()
    ctx.fill()
    ctx.restore()
    ctx.restore()
  }

  // ── 下部ボタン ──
  const bh=42; const bw=(W-48-12)/3; const by=H-botH+8+sb; const bx0=24
  const confirmMode=t<resetConfirmT
  drawBtn('もどす', bx0,by,bw,bh,false,!paper.canUndo())
  drawBtn(confirmMode?'ほんとに？':'はじめから', bx0+bw+6,by,bw,bh,false)
  drawBtn('ひらく', bx0+(bw+6)*2,by,bw,bh,true)

  // ヒントオーバーレイ（手本カードタップ）
  if(hintOpen) drawHintOverlay()
  drawExpLabel(ctx,W,H,'EXP-011','きって、ひらく。')
}

function drawHintOverlay(){
  ctx.fillStyle='rgba(0,0,0,0.55)'; ctx.fillRect(0,0,W,H)
  const lv=LEVELS[levelIdx]
  const tgt=getTarget(levelIdx)
  const sz=220
  const ox=(W-sz)/2; const oy=(H-sz)/2-40
  ctx.save()
  ctx.shadowColor='rgba(0,0,0,0.4)'; ctx.shadowBlur=20; ctx.shadowOffsetY=6
  rrect(ctx,ox-16,oy-16,sz+32,sz+90,10); ctx.fillStyle=C_PAPER; ctx.fill()
  ctx.restore()
  drawTape(ox+sz*0.2,oy-16,-0.1); drawTape(ox+sz*0.8,oy-16,0.12)
  const img=getCrest(`lv${levelIdx}`,tgt,sz,C_INK)
  ctx.drawImage(img,ox,oy)
  ctx.fillStyle=C_INK; ctx.textAlign='center'; ctx.textBaseline='alphabetic'
  ctx.font=`700 16px ${FS}`
  ctx.fillText(`${KANJI[levelIdx]}　${lv.name}`,W/2,oy+sz+22)
  if(lv.hint){
    ctx.fillStyle=hexA(C_INK,0.55); ctx.font=`400 13px ${FS}`
    ctx.fillText(lv.hint,W/2,oy+sz+44)
  }
  ctx.fillStyle=C_MUTED; ctx.font=`400 11px ${FSS}`
  ctx.fillText('もういちどたっぷで閉じる',W/2,oy+sz+66)
}

// ──────────────────────────────────────────────────────────────────
// OPENING
// ──────────────────────────────────────────────────────────────────
function drawOpening(){
  drawMat()
  const LIFT=0.25
  const UNFOLD=P.OPEN_MS/1000
  // dim overlay
  const dimAlpha=Math.min(1,openTimer/LIFT)*0.38
  ctx.fillStyle=`rgba(0,0,0,${dimAlpha})`; ctx.fillRect(0,0,W,H)

  const openR=Math.min(W,H)*0.42

  if(openPhase===0){
    // lift: paper移動
    const prog=easeInOut(Math.min(1,openTimer/LIFT))
    const curAy=lerp(liftFromAy,H/2,prog)
    drawPaperAtPos(paper,W/2,curAy,playS,1)
  } else {
    // unfold
    const elapsed=openTimer-LIFT
    const prog=easeOutCubic(Math.min(1,elapsed/UNFOLD))
    openCopies=prog*paper.copies
    const newFloor=Math.floor(openCopies)
    if(newFloor>prevFloor){
      for(let i=prevFloor;i<newFloor;i++) snd.unfoldTick(i,paper.copies)
      prevFloor=newFloor
    }
    ctx.save()
    paper.renderUnfolded(ctx,W/2,H/2,openR,0,openCopies)
    ctx.restore()
    if(prog>=1&&openPhase===1){
      openPhase=2
      snd.reveal()
      // 一瞬bounce: handled by resultT
      setScene('result')
    }
  }
  drawParticles()
}

// ──────────────────────────────────────────────────────────────────
// RESULT
// ──────────────────────────────────────────────────────────────────
function drawResult(){
  drawMat()
  ctx.fillStyle='rgba(0,0,0,0.38)'; ctx.fillRect(0,0,W,H)
  const sb=safeBottom()
  const openR=Math.min(W,H)*0.40

  // 紋（最終展開）
  const bounceScale = resultT<0.3 ? lerp(1,1.06,easeOutCubic(resultT/0.15)) : resultT<0.45 ? lerp(1.06,1,easeOutCubic((resultT-0.15)/0.15)) : 1
  ctx.save()
  ctx.translate(W/2,H*0.38)
  ctx.scale(bounceScale,bounceScale)
  ctx.translate(-W/2,-H*0.38)
  paper.renderUnfolded(ctx,W/2,H*0.38,openR,0,paper.copies)
  ctx.restore()

  // ── 紋の下の情報行：てほんカード（左）＋一致率（右隣） ──
  const infoY=H*0.38+openR+18

  // 手本紋（小・左側）
  const tgt=getTarget(levelIdx)
  const cimg=getCrest(`lv${levelIdx}`,tgt,72,C_INK)
  const teX=32; const teY=infoY
  ctx.save()
  ctx.shadowColor='rgba(0,0,0,0.25)'; ctx.shadowBlur=8
  rrect(ctx,teX,teY,96,96,5); ctx.fillStyle=C_PAPER; ctx.fill()
  ctx.restore()
  ctx.drawImage(cimg,teX+12,teY+6)
  ctx.fillStyle=hexA(C_INK,0.45); ctx.font=`400 10px ${FSS}`
  ctx.textAlign='center'; ctx.textBaseline='alphabetic'
  ctx.fillText('てほん',teX+48,teY+90)

  // 一致率カウントアップ（カードの右隣）
  const countProg=Math.min(1,resultT/0.6)
  const dispScore=simScore*easeOutCubic(countProg)
  if(simRank>0){
    ctx.fillStyle=C_MATTXT; ctx.textAlign='left'; ctx.textBaseline='middle'
    ctx.font=`400 16px ${FS}`
    ctx.fillText(`一致 ${(dispScore*100).toFixed(1)}%`,teX+112,infoY+48)
  } else if(resultT>0.5){
    ctx.fillStyle=C_MUTED; ctx.textAlign='left'; ctx.textBaseline='middle'
    ctx.font=`400 14px ${FS}`
    ctx.fillText('あと少し',teX+112,infoY+48)
  }

  // 判子（紋の右下すみ・縁に少し掛かる程度）
  const stampDelay=0.6
  if(resultT>=stampDelay&&simRank>0){
    if(!stampFired){
      stampFired=true; snd.stampThunk()
      shakeT=0.15; shakeX=(Math.random()-0.5)*6; shakeY=(Math.random()-0.5)*6
    }
    const se=resultT-stampDelay
    const sp=Math.min(1,se/0.35)
    const sc=lerp(1.8,1,easeOutCubic(sp))
    drawStamp(W/2+openR*0.75,H*0.38+openR*0.75,simRank,sc)
  }

  // ボタン
  const bh=44; const by=H-sb-bh-12
  const hasNext=levelIdx<LEVELS.length-1
  if(simRank>=1&&hasNext){
    const bw=(W-48)/3
    drawBtn('もういちど',24,by,bw,bh,false)
    drawBtn('手本帖へ',24+bw+6,by,bw,bh,false)
    drawBtn('つぎの題へ',24+(bw+6)*2,by,bw,bh,true)
  } else {
    const bw=(W-42)/2
    drawBtn('もういちど',24,by,bw,bh,false)
    drawBtn(simRank>=1?'手本帖へ':'もういちど',24+bw+6,by,bw,bh,simRank>=1)
  }

  drawParticles()
  drawExpLabel(ctx,W,H,'EXP-011','きって、ひらく。')
}

// ──────────────────────────────────────────────────────────────────
// FREE（白紙 折り選択）
// ──────────────────────────────────────────────────────────────────
function drawFree(){
  drawMat()
  ctx.fillStyle=C_MATTXT; ctx.textAlign='center'; ctx.textBaseline='alphabetic'
  ctx.font=`700 22px ${FS}`; ctx.fillText('白紙',W/2,48)
  ctx.fillStyle=C_MUTED; ctx.font=`400 11px ${FSS}`
  ctx.fillText('じゆうに、きる',W/2,64)

  const foldOpts=[1,2,3,4]
  const cw=(W-48-18)/4; const ch=80; const by=90
  foldOpts.forEach((n,i)=>{
    const x=24+i*(cw+6)
    const sel=n===freeN
    ctx.save()
    ctx.shadowColor='rgba(0,0,0,0.2)'; ctx.shadowBlur=6; ctx.shadowOffsetY=2
    rrect(ctx,x,by,cw,ch,6)
    ctx.fillStyle=sel?C_VRM:C_PAPER; ctx.fill()
    ctx.restore()
    ctx.fillStyle=sel?C_PAPER:C_INK; ctx.textAlign='center'; ctx.textBaseline='middle'
    ctx.font=`600 13px ${FS}`; ctx.fillText(FOLD_LABEL[n],x+cw/2,by+30)
    ctx.font=`400 10px ${FSS}`; ctx.fillStyle=sel?hexA(C_PAPER,0.8):C_MUTED
    ctx.fillText(`${n*2}枚合わせ`,x+cw/2,by+52)
  })

  // 「はじめる」ボタン
  const bbH=48; const bbY=by+ch+16
  drawBtn('はじめる',W/2-60,bbY,120,bbH,true)

  // ギャラリー
  if(save.gallery.length>0){
    const gapY=bbY+bbH+20
    ctx.fillStyle=C_MUTED; ctx.font=`400 11px ${FSS}`
    ctx.textAlign='left'; ctx.textBaseline='alphabetic'
    ctx.fillText('過去の紋',24,gapY)
    const gSize=52; const gGap=8; let gx=24
    save.gallery.slice(0,6).forEach(url=>{
      const img=new Image(); img.src=url
      ctx.save()
      ctx.shadowColor='rgba(0,0,0,0.22)'; ctx.shadowBlur=5; ctx.shadowOffsetY=2
      rrect(ctx,gx,gapY+10,gSize,gSize,4); ctx.fillStyle=C_PAPER; ctx.fill()
      ctx.restore()
      if(img.complete) ctx.drawImage(img,gx,gapY+10,gSize,gSize)
      gx+=gSize+gGap
    })
  }
  drawExpLabel(ctx,W,H,'EXP-011','きって、ひらく。')
}

// ──────────────────────────────────────────────────────────────────
// FREE PLAY
// ──────────────────────────────────────────────────────────────────
function drawFreePlay(_t:number){
  drawMat()
  const sb=safeBottom()
  const topH=46; const botH=70+sb
  const { ax, ay, s } = calcPaperTransform(freePaper, topH, botH)
  playAx=ax; playAy=ay; playS=s

  ctx.fillStyle=C_MATTXT; ctx.textAlign='left'; ctx.textBaseline='alphabetic'
  ctx.font=`700 14px ${FS}`; ctx.fillText(FOLD_LABEL[freePaper.N],70,30)
  ctx.fillStyle=C_MUTED; ctx.font=`400 11px ${FSS}`
  ctx.fillText(`鋏 ${freePaper.cutCount}`,70,46)

  drawPaperAtPos(freePaper,ax,ay,s)
  drawParticles()

  if(cutting&&cutPts.length>1){
    ctx.save()
    ctx.strokeStyle='rgba(51,46,36,0.75)'; ctx.lineWidth=1.5; ctx.lineCap='round'
    ctx.beginPath(); ctx.moveTo(cutPts[0].x,cutPts[0].y)
    for(let i=1;i<cutPts.length;i++) ctx.lineTo(cutPts[i].x,cutPts[i].y)
    ctx.stroke(); ctx.restore()
  }

  const bh=42; const bw=(W-42-12)/3; const by=H-botH+8+sb
  drawBtn('もどす',24,by,bw,bh,false,!freePaper.canUndo())
  drawBtn('はじめから',24+bw+6,by,bw,bh,false)
  drawBtn('ひらく',24+(bw+6)*2,by,bw,bh,true)
  drawExpLabel(ctx,W,H,'EXP-011','きって、ひらく。')
}

// ──────────────────────────────────────────────────────────────────
// FREE OPENING
// ──────────────────────────────────────────────────────────────────
function drawFreeOpening(){
  drawMat()
  const LIFT=0.25; const UNFOLD=P.OPEN_MS/1000
  const dimAlpha=Math.min(1,openTimer/LIFT)*0.38
  ctx.fillStyle=`rgba(0,0,0,${dimAlpha})`; ctx.fillRect(0,0,W,H)
  const openR=Math.min(W,H)*0.42
  if(openPhase===0){
    const prog=easeInOut(Math.min(1,openTimer/LIFT))
    const curAy=lerp(liftFromAy,H/2,prog)
    drawPaperAtPos(freePaper,W/2,curAy,playS,1)
  } else {
    const elapsed=openTimer-LIFT
    const prog=easeOutCubic(Math.min(1,elapsed/UNFOLD))
    openCopies=prog*freePaper.copies
    const newFloor=Math.floor(openCopies)
    if(newFloor>prevFloor){
      for(let i=prevFloor;i<newFloor;i++) snd.unfoldTick(i,freePaper.copies)
      prevFloor=newFloor
    }
    freePaper.renderUnfolded(ctx,W/2,H/2,openR,0,openCopies)
    if(prog>=1&&openPhase===1){
      openPhase=2; snd.reveal()
      setScene('free_result')
    }
  }
  drawParticles()
}

// ──────────────────────────────────────────────────────────────────
// FREE RESULT
// ──────────────────────────────────────────────────────────────────
function drawFreeResult(){
  drawMat()
  ctx.fillStyle='rgba(0,0,0,0.38)'; ctx.fillRect(0,0,W,H)
  const sb=safeBottom()
  const openR=Math.min(W,H)*0.42
  freePaper.renderUnfolded(ctx,W/2,H*0.42,openR,0,freePaper.copies)

  ctx.fillStyle=C_MATTXT; ctx.textAlign='center'; ctx.textBaseline='alphabetic'
  ctx.font=`400 13px ${FS}`; ctx.fillText('ひらいた紋',W/2,H*0.42-openR-10)

  const bh=44; const by=H-sb-bh-12
  const bw=(W-48-12)/3
  drawBtn('とじて つづきを きる',24,by,bw,bh,false)
  drawBtn('あたらしい紙',24+bw+6,by,bw,bh,false)
  drawBtn('白紙帖へ',24+(bw+6)*2,by,bw,bh,true)
  drawExpLabel(ctx,W,H,'EXP-011','きって、ひらく。')
}

// ──────────────────────────────────────────────────────────────────
// TARGETS（QA用）
// ──────────────────────────────────────────────────────────────────
function drawTargets(){
  drawMat()
  const cols=3; const rows=4
  const cw=Math.floor((W-32-12)/cols); const ch=Math.floor((H-32-18)/rows)
  for(let i=0;i<12;i++){
    const col=i%cols; const row=Math.floor(i/cols)
    const cx=16+col*(cw+6); const cy=16+row*(ch+6)
    ctx.fillStyle=hexA(C_PAPER,0.1); rrect(ctx,cx,cy,cw,ch,4); ctx.fill()
    const sz=Math.floor(Math.min(cw,ch)*0.72)
    const tgt=getTarget(i)
    const img=getCrest(`qa${i}`,tgt,sz,C_MATTXT)
    ctx.drawImage(img,cx+(cw-sz)/2,cy+(ch-sz)/2)
    ctx.fillStyle=C_MATTXT; ctx.font=`400 10px ${FSS}`
    ctx.textAlign='center'; ctx.textBaseline='alphabetic'
    ctx.fillText(LEVELS[i].id,cx+cw/2,cy+ch-4)
  }
}

// ──────────────────────────────────────────────────────────────────
// パーティクル描画
// ──────────────────────────────────────────────────────────────────
function drawParticles(){
  for(const p of particles){
    const a=Math.max(0,1-p.age/PART_DUR)
    if(a<=0) continue
    ctx.save(); ctx.globalAlpha=a
    const wobble=Math.sin(p.wobble+p.age*8)*0.25
    ctx.translate(p.px,p.py)
    ctx.rotate(p.rot+wobble)
    ctx.scale(playS,playS)
    ctx.drawImage(p.frag.canvas,-(p.frag.cx-p.frag.x),-(p.frag.cy-p.frag.y))
    ctx.restore()
  }
}

// ──────────────────────────────────────────────────────────────────
// シーン遷移
// ──────────────────────────────────────────────────────────────────
function setScene(s: Scene){
  scene=s
  if(s==='play'){
    hintOpen=false; cutting=false; cutPts=[]; guideDirty=true; guideCanvas=null
    particles=[]; resetConfirmT=-999; stampFired=false; resultT=0
    snd.startWindchime()
  }
  if(s==='free_play'){
    cutting=false; cutPts=[]; particles=[]; resetConfirmT=-999
    snd.startWindchime()
  }
  if(s==='opening'||s==='free_opening'){
    openTimer=0; openPhase=0; openCopies=0; prevFloor=0
    liftFromAy=playAy
    snd.stopWindchime()
  }
  if(s==='result'){
    resultT=0; stampFired=false; shakeT=0
    simScore=paper.similarity(getTarget(levelIdx))
    simRank=scoreToRank(simScore)
    setRank(LEVELS[levelIdx].id,simRank)
  }
  if(s==='free_result'){
    resultT=0
    saveGallery()
  }
  if(s==='techo'||s==='title') snd.stopWindchime()
}

function scoreToRank(score: number): number {
  if(score>=P.YUKI) return 4
  if(score>=P.MATSU) return 3
  if(score>=P.TAKE) return 2
  if(score>=P.UME) return 1
  return 0
}

function saveGallery(){
  try {
    const gc=document.createElement('canvas')
    gc.width=gc.height=128
    const gctx=gc.getContext('2d')!
    freePaper.renderUnfolded(gctx,64,64,60)
    const url=gc.toDataURL('image/png')
    save.gallery.unshift(url)
    if(save.gallery.length>6) save.gallery.pop()
    writeSave()
  } catch {}
}

// ──────────────────────────────────────────────────────────────────
// ポインタ座標 → ウェッジ座標
// ──────────────────────────────────────────────────────────────────
function screenToWedge(px:number,py:number,p:Paper,ax:number,ay:number,s:number):{x:number,y:number}{
  return { x: p.apex.x+(ay-py)/s, y: p.apex.y+(px-ax)/s }
}

// ──────────────────────────────────────────────────────────────────
// ポインタ処理（justPressed/up の検出）
// ──────────────────────────────────────────────────────────────────
let wasDown=false

function onTap(px:number,py:number){
  const sb=safeBottom()

  if(scene==='title'){
    setScene('techo'); snd.tick(); return
  }

  if(scene==='techo'){
    // カード格子（描画と同じ techoLayout を共有）
    const L=techoLayout()
    for(let i=0;i<12;i++){
      const col=i%L.cols; const row=Math.floor(i/L.cols)
      const cx=L.margin+col*(L.cw+L.gap); const cy=L.headerH+row*(L.ch+L.gap)
      if(hitRect(px,py,cx,cy,L.cw,L.ch)){
        if(!isUnlocked(i)){ snd.tick(); return }
        levelIdx=i; paper=new Paper(LEVELS[i].N); setScene('play'); snd.tick(); return
      }
    }
    // 自由切りカード
    if(hitRect(px,py,L.margin,L.freeY,W-L.margin*2,L.freeH)){ setScene('free'); snd.tick(); return }
    return
  }

  if(scene==='play'){
    if(hintOpen){ hintOpen=false; snd.tick(); return }
    const botH=76+sb
    const bh=42; const bw=(W-48-12)/3; const by=H-botH+8+sb
    const bx0=24
    const now_t=performance.now()/1000
    // 手本カード タップ
    const cc=92; const ccx=W-cc-8; const ccy=6
    if(hitRect(px,py,ccx,ccy,cc,cc)){ hintOpen=true; snd.tick(); return }
    // もどす
    if(hitRect(px,py,bx0,by,bw,bh)){
      if(paper.canUndo()){ paper.undo(); guideDirty=true; snd.tick() }; return
    }
    // はじめから
    if(hitRect(px,py,bx0+bw+6,by,bw,bh)){
      if(now_t<resetConfirmT){
        paper.reset(); guideDirty=true; particles=[]; resetConfirmT=-999; snd.tick()
      } else { resetConfirmT=now_t+3; snd.tick() }
      return
    }
    // ひらく
    if(hitRect(px,py,bx0+(bw+6)*2,by,bw,bh)){
      setScene('opening'); snd.tick(); return
    }
    return
  }

  if(scene==='result'){
    const hasNext=levelIdx<LEVELS.length-1
    const bh=44; const by=H-sb-bh-12
    if(hasNext&&simRank>=1){
      const bw=(W-48)/3
      if(hitRect(px,py,24,by,bw,bh)){
        // もういちど
        paper=new Paper(LEVELS[levelIdx].N); setScene('play'); snd.tick(); return
      }
      if(hitRect(px,py,24+bw+6,by,bw,bh)){
        setScene('techo'); snd.tick(); return
      }
      if(hitRect(px,py,24+(bw+6)*2,by,bw,bh)){
        levelIdx=Math.min(LEVELS.length-1,levelIdx+1)
        paper=new Paper(LEVELS[levelIdx].N); setScene('play'); snd.tick(); return
      }
    } else {
      const bw=(W-42)/2
      if(hitRect(px,py,24,by,bw,bh)){
        paper=new Paper(LEVELS[levelIdx].N); setScene('play'); snd.tick(); return
      }
      if(hitRect(px,py,24+bw+6,by,bw,bh)){
        if(simRank>=1){ setScene('techo') } else { paper=new Paper(LEVELS[levelIdx].N); setScene('play') }
        snd.tick(); return
      }
    }
    return
  }

  if(scene==='free'){
    const foldOpts=[1,2,3,4]
    const cw=(W-48-18)/4; const ch=80; const by=90
    foldOpts.forEach((n,i)=>{
      const x=24+i*(cw+6)
      if(hitRect(px,py,x,by,cw,ch)){ freeN=n; snd.tick() }
    })
    // はじめるボタン
    if(hitRect(px,py,W/2-60,by+ch+16,120,48)){
      freePaper=new Paper(freeN); setScene('free_play'); snd.tick()
    }
    return
  }

  if(scene==='free_play'){
    const sb2=safeBottom()
    const botH=70+sb2
    const bh=42; const bw=(W-42-12)/3; const by=H-botH+8+sb2
    const now_t=performance.now()/1000
    if(hitRect(px,py,24,by,bw,bh)){
      if(freePaper.canUndo()){ freePaper.undo(); snd.tick() }; return
    }
    if(hitRect(px,py,24+bw+6,by,bw,bh)){
      if(now_t<resetConfirmT){ freePaper.reset(); particles=[]; resetConfirmT=-999; snd.tick() }
      else { resetConfirmT=now_t+3; snd.tick() }; return
    }
    if(hitRect(px,py,24+(bw+6)*2,by,bw,bh)){
      setScene('free_opening'); snd.tick(); return
    }
    return
  }

  if(scene==='free_result'){
    const sb2=safeBottom()
    const bh=44; const by=H-sb2-bh-12
    const bw=(W-48-12)/3
    if(hitRect(px,py,24,by,bw,bh)){
      // とじて続きを切る
      setScene('free_play'); snd.tick(); return
    }
    if(hitRect(px,py,24+bw+6,by,bw,bh)){
      freePaper=new Paper(freeN); setScene('free_play'); snd.tick(); return
    }
    if(hitRect(px,py,24+(bw+6)*2,by,bw,bh)){
      setScene('free'); snd.tick(); return
    }
    return
  }
}

function onPointerUp(_px:number,_py:number,isPlay:boolean){
  if(!cutting) return
  cutting=false
  const p=isPlay?paper:freePaper
  const wedgePts=cutPts.map(pt=>screenToWedge(pt.x,pt.y,p,playAx,playAy,playS))
  const frags=p.strokeCut(wedgePts)
  guideDirty=true
  let didFlutter=false
  for(const f of frags){
    const fx=playAx+(f.cy-p.apex.y)*playS
    const fy=playAy-(f.cx-p.apex.x)*playS
    particles.push({
      frag:f, px:fx, py:fy,
      vx:(Math.random()-0.5)*80,
      vy:-30+Math.random()*50,
      rot:-Math.PI/2+(Math.random()-0.5)*0.3,
      wobble:Math.random()*Math.PI*2,
      age:0,
    })
    if(f.area>=400&&!didFlutter){ snd.flutter(); didFlutter=true }
  }
  cutPts=[]
}

// ──────────────────────────────────────────────────────────────────
// RAFループ
// ──────────────────────────────────────────────────────────────────
let lastRaf=0

function loop(now:number){
  requestAnimationFrame(loop)
  const rawDt=(now-lastRaf)/1000
  lastRaf=now
  const dt=clamp(rawDt,0,0.05)
  const t=now/1000

  // shake decay
  if(shakeT>0){
    shakeT=Math.max(0,shakeT-dt)
    if(shakeT>0){
      shakeX=(Math.random()-0.5)*6*(shakeT/0.15)
      shakeY=(Math.random()-0.5)*6*(shakeT/0.15)
    } else { shakeX=0; shakeY=0 }
  }

  // パーティクル更新
  for(const p of particles){
    p.vy+=P.FALL_G*dt
    p.px+=p.vx*dt; p.py+=p.vy*dt; p.age+=dt
  }
  particles=particles.filter(p=>p.age<PART_DUR)

  // タイトルデモ更新
  if(scene==='title'&&!SHOT){
    demoPhaseT+=dt
    if(demoPhase===0){
      const prog=Math.min(1,demoPhaseT/DEMO_OPEN_DUR)
      demoCopies=easeOutCubic(prog)*(demoTarget?.copies??8)
      if(prog>=1){ demoPhase=1; demoPhaseT=0 }
    } else if(demoPhase===1){
      if(demoPhaseT>=DEMO_HOLD_DUR){ demoPhase=2; demoPhaseT=0 }
    } else {
      if(demoPhaseT>=DEMO_FADE_DUR){ demoPhase=0; demoPhaseT=0; demoCopies=0 }
    }
  }

  // opening 更新
  if(scene==='opening'||scene==='free_opening'){
    openTimer+=dt
    if(openPhase===0&&openTimer>=0.25){ openPhase=1 }
  }

  // result 更新
  if(scene==='result'||scene==='free_result'){ resultT+=dt }

  // ポインタ処理（drag for cutting）
  const isPlayScene=scene==='play'||scene==='free_play'
  const curPaper=scene==='free_play'?freePaper:paper
  if(isPlayScene){
    if(ptr.down){
      if(!wasDown){
        // pointerdown — check if in paper area
        const w=screenToWedge(ptr.x,ptr.y,curPaper,playAx,playAy,playS)
        const dist=Math.sqrt((w.x-curPaper.apex.x)**2+(w.y-curPaper.apex.y)**2)
        const ang=Math.abs(Math.atan2(w.y-curPaper.apex.y,w.x-curPaper.apex.x))
        if(dist>=0&&dist<=curPaper.R&&ang<=curPaper.halfAngle+0.02){
          cutting=true; cutPts=[{x:ptr.x,y:ptr.y}]
          snipAccum=0; lastSnipX=ptr.x; lastSnipY=ptr.y
          snd.ensureAudio()
        }
      } else if(cutting){
        const last=cutPts[cutPts.length-1]
        const dx=ptr.x-last.x; const dy=ptr.y-last.y
        if(dx*dx+dy*dy>4){ cutPts.push({x:ptr.x,y:ptr.y}) }
        const dd=Math.sqrt((ptr.x-lastSnipX)**2+(ptr.y-lastSnipY)**2)
        snipAccum+=dd; lastSnipX=ptr.x; lastSnipY=ptr.y
        if(snipAccum>=24){ snd.snip((Math.random()-0.5)*2); snipAccum=0 }
      }
    } else if(wasDown&&cutting){
      onPointerUp(ptr.x,ptr.y,scene==='play')
    }
  }

  // justPressed → onTap（非切り操作時）
  if(ptr.justPressed&&!cutting){ onTap(ptr.x,ptr.y) }
  wasDown=ptr.down
  ptrh.endFrame()

  // 描画
  ctx.save()
  if(shakeT>0) ctx.translate(shakeX,shakeY)

  if(scene==='targets') drawTargets()
  else if(scene==='title') drawTitle(t)
  else if(scene==='techo') drawTecho()
  else if(scene==='play') drawPlay(t)
  else if(scene==='opening') drawOpening()
  else if(scene==='result') drawResult()
  else if(scene==='free') drawFree()
  else if(scene==='free_play') drawFreePlay(t)
  else if(scene==='free_opening') drawFreeOpening()
  else if(scene==='free_result') drawFreeResult()

  ctx.restore()
}

// ──────────────────────────────────────────────────────────────────
// 初期化
// ──────────────────────────────────────────────────────────────────
mountMuteButton()
wireLink(document.querySelector('a.back')!)
enterTransition()

fitCanvas(canvas,(w,h)=>{ W=w; H=h; guideDirty=true })

// デモターゲット生成（タイトル用）
demoTarget=getTarget(9)  // きく (N=4)
demoCopies=0

// SHOT初期化
if(SHOT){
  const shotLevel=parseInt(Q.get('level')||'0')||0
  if(SHOT==='title'){
    scene='title'; demoCopies=demoTarget?.copies??8; demoPhase=1
  } else if(SHOT==='techo'){
    scene='techo'
  } else if(SHOT==='play'){
    levelIdx=clamp(shotLevel,0,LEVELS.length-1)
    paper=new Paper(LEVELS[levelIdx].N)
    const lv=LEVELS[levelIdx]
    const halfCuts=Math.ceil(lv.cuts.length/2)
    for(let i=0;i<halfCuts;i++) paper.applyCut(lv.cuts[i])
    scene='play'
    const topH=58; const botH=76
    const par=calcPaperTransform(paper,topH,botH)
    playAx=par.ax; playAy=par.ay; playS=par.s
    if(lv.guide){ guideCanvas=buildGuide(paper); guideDirty=false }
  } else if(SHOT==='open'){
    levelIdx=clamp(shotLevel,0,LEVELS.length-1)
    paper=new Paper(LEVELS[levelIdx].N)
    const lv=LEVELS[levelIdx]
    for(const cut of lv.cuts) paper.applyCut(cut)
    simScore=paper.similarity(getTarget(levelIdx))
    simRank=scoreToRank(simScore)
    resultT=0.8; stampFired=true
    const topH=58; const botH=76
    const par=calcPaperTransform(paper,topH,botH)
    playAx=par.ax; playAy=par.ay; playS=par.s
    scene='result'
  } else if(SHOT==='targets'){
    scene='targets'
  }
}

requestAnimationFrame((now)=>{ lastRaf=now; requestAnimationFrame(loop) })
