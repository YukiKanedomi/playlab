// 『流灯』GPU流体ソルバ — Stable Fluids（Jos Stam 1999）の標準構成を自前実装。
// 速度場: 半ラグランジュ移流 → 渦度強化 → 圧力ヤコビ反復 → 勾配減算。染料は速度場で移流。
// WebGL2(+EXT_color_buffer_(half_)float) を優先し、WebGL1(+OES_texture_half_float) にフォールバック。
// ゲーム側API: step / splatVelocity / splatDye / setObstacles / readProbe / render

type FBO = { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }
type DoubleFBO = { read: FBO; write: FBO; swap(): void }

const VERT = `
precision highp float;
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

// 共通ヘッダ（texel サイズ）
const HEAD = `
precision highp float;
varying vec2 vUv;
uniform vec2 uTexel;
`

const FRAG_ADVECT = HEAD + `
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform sampler2D uMask;
uniform float uDt;
uniform float uDissipation;
void main() {
  vec2 vel = texture2D(uVelocity, vUv).xy;
  vec2 coord = vUv - uDt * vel * uTexel;
  vec4 result = texture2D(uSource, coord);
  float decay = 1.0 + uDissipation * uDt;
  float m = texture2D(uMask, vUv).r;
  gl_FragColor = (result / decay) * m;
}`

const FRAG_SPLAT = HEAD + `
uniform sampler2D uTarget;
uniform vec3 uColor;
uniform vec2 uPoint;
uniform float uRadius;
uniform float uAspect;
void main() {
  vec2 d = vUv - uPoint;
  d.x *= uAspect;
  float a = exp(-dot(d, d) / uRadius);
  vec3 base = texture2D(uTarget, vUv).xyz;
  gl_FragColor = vec4(base + uColor * a, 1.0);
}`

const FRAG_CURL = HEAD + `
uniform sampler2D uVelocity;
void main() {
  float L = texture2D(uVelocity, vUv - vec2(uTexel.x, 0.0)).y;
  float R = texture2D(uVelocity, vUv + vec2(uTexel.x, 0.0)).y;
  float B = texture2D(uVelocity, vUv - vec2(0.0, uTexel.y)).x;
  float T = texture2D(uVelocity, vUv + vec2(0.0, uTexel.y)).x;
  gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}`

const FRAG_VORTICITY = HEAD + `
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float uCurlStrength;
uniform float uDt;
void main() {
  float L = texture2D(uCurl, vUv - vec2(uTexel.x, 0.0)).r;
  float R = texture2D(uCurl, vUv + vec2(uTexel.x, 0.0)).r;
  float B = texture2D(uCurl, vUv - vec2(0.0, uTexel.y)).r;
  float T = texture2D(uCurl, vUv + vec2(0.0, uTexel.y)).r;
  float C = texture2D(uCurl, vUv).r;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= uCurlStrength * C * vec2(1.0, -1.0);
  vec2 vel = texture2D(uVelocity, vUv).xy + force * uDt;
  gl_FragColor = vec4(clamp(vel, -1000.0, 1000.0), 0.0, 1.0);
}`

const FRAG_DIVERGENCE = HEAD + `
uniform sampler2D uVelocity;
uniform sampler2D uMask;
void main() {
  float L = texture2D(uVelocity, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture2D(uVelocity, vUv + vec2(uTexel.x, 0.0)).x;
  float B = texture2D(uVelocity, vUv - vec2(0.0, uTexel.y)).y;
  float T = texture2D(uVelocity, vUv + vec2(0.0, uTexel.y)).y;
  vec2 C = texture2D(uVelocity, vUv).xy;
  // 端・障害物は滑りなし境界（法線速度を打ち消す）
  if (vUv.x - uTexel.x < 0.0) { L = -C.x; }
  if (vUv.x + uTexel.x > 1.0) { R = -C.x; }
  if (vUv.y - uTexel.y < 0.0) { B = -C.y; }
  if (vUv.y + uTexel.y > 1.0) { T = -C.y; }
  if (texture2D(uMask, vUv - vec2(uTexel.x, 0.0)).r < 0.5) { L = -C.x; }
  if (texture2D(uMask, vUv + vec2(uTexel.x, 0.0)).r < 0.5) { R = -C.x; }
  if (texture2D(uMask, vUv - vec2(0.0, uTexel.y)).r < 0.5) { B = -C.y; }
  if (texture2D(uMask, vUv + vec2(0.0, uTexel.y)).r < 0.5) { T = -C.y; }
  gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`

const FRAG_PRESSURE = HEAD + `
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
void main() {
  float L = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).r;
  float R = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).r;
  float B = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).r;
  float T = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).r;
  float div = texture2D(uDivergence, vUv).r;
  gl_FragColor = vec4((L + R + B + T - div) * 0.25, 0.0, 0.0, 1.0);
}`

const FRAG_GRADIENT = HEAD + `
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
uniform sampler2D uMask;
void main() {
  float L = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).r;
  float R = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).r;
  float B = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).r;
  float T = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).r;
  vec2 vel = texture2D(uVelocity, vUv).xy - vec2(R - L, T - B) * 0.5;
  float m = texture2D(uMask, vUv).r;
  gl_FragColor = vec4(vel * m, 0.0, 1.0);
}`

// 画面表示：染料をそのまま加算的な発光として描く（夜の水面に灯りが流れる想定）
const FRAG_DISPLAY = HEAD + `
uniform sampler2D uDye;
uniform sampler2D uMask;
uniform vec3 uBg;
void main() {
  vec3 dye = texture2D(uDye, vUv).rgb;
  // 淡い所も見えるようトーンを持ち上げ、濃い所は飽和させない
  vec3 c = uBg + dye * 1.15;
  c = c / (1.0 + dye * 0.25);
  float m = texture2D(uMask, vUv).r;
  c = mix(uBg * 0.55, c, m); // 障害物セルはわずかに沈める（岩の絵は2D側で重ねる）
  gl_FragColor = vec4(c, 1.0);
}`

// プローブ用：染料をそのまま出す（RGBA8 に落として readPixels する）
const FRAG_PROBE = HEAD + `
uniform sampler2D uDye;
void main() {
  vec3 dye = texture2D(uDye, vUv).rgb;
  gl_FragColor = vec4(clamp(dye, 0.0, 1.0), 1.0);
}`

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s))
  return s
}

class Program {
  prog: WebGLProgram
  uniforms: Record<string, WebGLUniformLocation> = {}
  constructor(gl: WebGLRenderingContext, vs: WebGLShader, fsSrc: string) {
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc)
    this.prog = gl.createProgram()!
    gl.attachShader(this.prog, vs)
    gl.attachShader(this.prog, fs)
    gl.bindAttribLocation(this.prog, 0, 'aPos')
    gl.linkProgram(this.prog)
    if (!gl.getProgramParameter(this.prog, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(this.prog))
    const n = gl.getProgramParameter(this.prog, gl.ACTIVE_UNIFORMS)
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(this.prog, i)!
      this.uniforms[info.name] = gl.getUniformLocation(this.prog, info.name)!
    }
  }
}

export type FluidOpts = {
  simRes?: number // 短辺の格子数
  dyeRes?: number
  pressureIters?: number
  curl?: number // 渦度強化の強さ
  velDissipation?: number
  dyeDissipation?: number
  bg?: [number, number, number]
}

export class FluidSim {
  gl: WebGLRenderingContext
  private canvas: HTMLCanvasElement
  private isGL2: boolean
  private halfFloat = 0
  private supportLinear = true
  private quad!: WebGLBuffer
  private vs!: WebGLShader
  private pAdvect!: Program
  private pSplat!: Program
  private pCurl!: Program
  private pVort!: Program
  private pDiv!: Program
  private pPress!: Program
  private pGrad!: Program
  private pDisplay!: Program
  private pProbe!: Program
  private velocity!: DoubleFBO
  private dye!: DoubleFBO
  private pressure!: DoubleFBO
  private divergence!: FBO
  private curlFbo!: FBO
  private maskTex!: WebGLTexture
  private probeFbo!: FBO
  private probeBuf!: Uint8Array
  simW = 0
  simH = 0
  dyeW = 0
  dyeH = 0
  probeW = 0
  probeH = 0
  opts: Required<FluidOpts>

  constructor(canvas: HTMLCanvasElement, opts: FluidOpts = {}) {
    this.canvas = canvas
    this.opts = {
      simRes: opts.simRes ?? 110,
      dyeRes: opts.dyeRes ?? 440,
      pressureIters: opts.pressureIters ?? 20,
      curl: opts.curl ?? 24,
      velDissipation: opts.velDissipation ?? 0.25,
      dyeDissipation: opts.dyeDissipation ?? 0.35,
      bg: opts.bg ?? [0.05, 0.06, 0.12],
    }
    const attrs: WebGLContextAttributes = { alpha: false, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false }
    let gl = canvas.getContext('webgl2', attrs) as WebGLRenderingContext | null
    this.isGL2 = !!gl
    if (gl) {
      const ok = (gl as WebGL2RenderingContext).getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')
      if (!ok) {
        gl = null // float FBO が焼けない WebGL2 → WebGL1 経路へ
        this.isGL2 = false
      }
    }
    if (!gl) {
      gl = canvas.getContext('webgl', attrs) as WebGLRenderingContext | null
      if (!gl) throw new Error('WebGL未対応')
      const ext = gl.getExtension('OES_texture_half_float')
      if (!ext) throw new Error('half float未対応')
      this.halfFloat = ext.HALF_FLOAT_OES
      this.supportLinear = !!gl.getExtension('OES_texture_half_float_linear')
    }
    this.gl = gl
    if (this.isGL2) {
      this.halfFloat = (gl as WebGL2RenderingContext).HALF_FLOAT
      this.supportLinear = true
    }
    this.init()
  }

  private init() {
    const gl = this.gl
    this.quad = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    this.vs = compile(gl, gl.VERTEX_SHADER, VERT)
    this.pAdvect = new Program(gl, this.vs, FRAG_ADVECT)
    this.pSplat = new Program(gl, this.vs, FRAG_SPLAT)
    this.pCurl = new Program(gl, this.vs, FRAG_CURL)
    this.pVort = new Program(gl, this.vs, FRAG_VORTICITY)
    this.pDiv = new Program(gl, this.vs, FRAG_DIVERGENCE)
    this.pPress = new Program(gl, this.vs, FRAG_PRESSURE)
    this.pGrad = new Program(gl, this.vs, FRAG_GRADIENT)
    this.pDisplay = new Program(gl, this.vs, FRAG_DISPLAY)
    this.pProbe = new Program(gl, this.vs, FRAG_PROBE)
    this.allocate()
  }

  /** キャンバスの縦横比に合わせて格子を確保（リサイズ時にも呼ぶ。場はリセットされる） */
  allocate() {
    const gl = this.gl
    const aspect = this.canvas.width / Math.max(1, this.canvas.height)
    const s = this.opts.simRes
    this.simW = aspect >= 1 ? Math.round(s * aspect) : s
    this.simH = aspect >= 1 ? s : Math.round(s / aspect)
    const d = this.opts.dyeRes
    this.dyeW = aspect >= 1 ? Math.round(d * aspect) : d
    this.dyeH = aspect >= 1 ? d : Math.round(d / aspect)
    this.probeW = 60
    this.probeH = Math.max(8, Math.round(60 * this.simH / this.simW))

    const rg = this.isGL2 ? (gl as WebGL2RenderingContext).RG16F : gl.RGBA
    const rgFmt = this.isGL2 ? (gl as WebGL2RenderingContext).RG : gl.RGBA
    const r = this.isGL2 ? (gl as WebGL2RenderingContext).R16F : gl.RGBA
    const rFmt = this.isGL2 ? (gl as WebGL2RenderingContext).RED : gl.RGBA
    const rgba = this.isGL2 ? (gl as WebGL2RenderingContext).RGBA16F : gl.RGBA

    this.velocity = this.doubleFbo(this.simW, this.simH, rg, rgFmt, this.halfFloat, this.supportLinear)
    this.dye = this.doubleFbo(this.dyeW, this.dyeH, rgba, gl.RGBA, this.halfFloat, this.supportLinear)
    this.pressure = this.doubleFbo(this.simW, this.simH, r, rFmt, this.halfFloat, false)
    this.divergence = this.fbo(this.simW, this.simH, r, rFmt, this.halfFloat, false)
    this.curlFbo = this.fbo(this.simW, this.simH, r, rFmt, this.halfFloat, false)
    this.probeFbo = this.fbo(this.probeW, this.probeH, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, false)
    this.probeBuf = new Uint8Array(this.probeW * this.probeH * 4)
    // 障害物マスク（1=水, 0=岩）。既定は全面水。
    this.maskTex = gl.createTexture()!
    this.setObstacleMask(null)
  }

  private tex(w: number, h: number, ifmt: number, fmt: number, type: number, linear: boolean): WebGLTexture {
    const gl = this.gl
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, linear ? gl.LINEAR : gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, null)
    return t
  }
  private fbo(w: number, h: number, ifmt: number, fmt: number, type: number, linear: boolean): FBO {
    const gl = this.gl
    const tex = this.tex(w, h, ifmt, fmt, type, linear)
    const fb = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    return { fb, tex, w, h }
  }
  private doubleFbo(w: number, h: number, ifmt: number, fmt: number, type: number, linear: boolean): DoubleFBO {
    let a = this.fbo(w, h, ifmt, fmt, type, linear)
    let b = this.fbo(w, h, ifmt, fmt, type, linear)
    return {
      get read() { return a },
      get write() { return b },
      swap() { const t = a; a = b; b = t },
    } as DoubleFBO
  }

  /** 障害物マスク。circles/rects は正規化座標(0..1, y下向き)。null で全面水 */
  setObstacleMask(shapes: { circles?: { x: number; y: number; r: number }[]; rects?: { x: number; y: number; w: number; h: number }[] } | null) {
    const gl = this.gl
    const w = this.simW
    const h = this.simH
    const data = new Uint8Array(w * h)
    data.fill(255)
    if (shapes) {
      const aspect = w / h
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const x = (i + 0.5) / w
          const y = 1 - (j + 0.5) / h // テクスチャは下から。ゲーム座標は y 下向きで渡す
          let solid = false
          for (const c of shapes.circles || []) {
            const dx = (x - c.x) * aspect
            const dy = y - c.y
            if (dx * dx + dy * dy < c.r * c.r * aspect * aspect) { solid = true; break }
          }
          if (!solid) for (const rc of shapes.rects || []) {
            if (x >= rc.x && x <= rc.x + rc.w && y >= rc.y && y <= rc.y + rc.h) { solid = true; break }
          }
          if (solid) data[j * w + i] = 0
        }
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    const ifmt = this.isGL2 ? (gl as WebGL2RenderingContext).R8 : gl.LUMINANCE
    const fmt = this.isGL2 ? (gl as WebGL2RenderingContext).RED : gl.LUMINANCE
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, gl.UNSIGNED_BYTE, data)
  }

  private bind(target: FBO | null) {
    const gl = this.gl
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb)
      gl.viewport(0, 0, target.w, target.h)
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    }
  }
  private drawQuad() {
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
  private use(p: Program) {
    this.gl.useProgram(p.prog)
    return p.uniforms
  }
  private setTex(u: WebGLUniformLocation, tex: WebGLTexture, unit: number) {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(u, unit)
  }

  /** x,y: 0..1（y下向き=画面座標系）。dx,dy: 画面比の速度。color: 染料RGB(0..1) */
  splat(x: number, y: number, dx: number, dy: number, color: [number, number, number] | null, radius = 0.0016) {
    const gl = this.gl
    const py = 1 - y
    // 速度
    let u = this.use(this.pSplat)
    this.bind(this.velocity.write)
    gl.uniform2f(u.uTexel, 1 / this.simW, 1 / this.simH)
    this.setTex(u.uTarget, this.velocity.read.tex, 0)
    gl.uniform2f(u.uPoint, x, py)
    gl.uniform3f(u.uColor, dx, -dy, 0)
    gl.uniform1f(u.uRadius, radius)
    gl.uniform1f(u.uAspect, this.simW / this.simH)
    this.drawQuad()
    this.velocity.swap()
    // 染料
    if (color) {
      u = this.use(this.pSplat)
      this.bind(this.dye.write)
      gl.uniform2f(u.uTexel, 1 / this.dyeW, 1 / this.dyeH)
      this.setTex(u.uTarget, this.dye.read.tex, 0)
      gl.uniform2f(u.uPoint, x, py)
      gl.uniform3f(u.uColor, color[0], color[1], color[2])
      gl.uniform1f(u.uRadius, radius)
      gl.uniform1f(u.uAspect, this.dyeW / this.dyeH)
      this.drawQuad()
      this.dye.swap()
    }
  }

  step(dt: number) {
    const gl = this.gl
    gl.disable(gl.BLEND)
    const texel: [number, number] = [1 / this.simW, 1 / this.simH]

    // 速度の移流
    let u = this.use(this.pAdvect)
    this.bind(this.velocity.write)
    gl.uniform2f(u.uTexel, texel[0], texel[1])
    this.setTex(u.uVelocity, this.velocity.read.tex, 0)
    this.setTex(u.uSource, this.velocity.read.tex, 0)
    this.setTex(u.uMask, this.maskTex, 1)
    gl.uniform1f(u.uDt, dt)
    gl.uniform1f(u.uDissipation, this.opts.velDissipation)
    this.drawQuad()
    this.velocity.swap()

    // 渦度
    u = this.use(this.pCurl)
    this.bind(this.curlFbo)
    gl.uniform2f(u.uTexel, texel[0], texel[1])
    this.setTex(u.uVelocity, this.velocity.read.tex, 0)
    this.drawQuad()

    u = this.use(this.pVort)
    this.bind(this.velocity.write)
    gl.uniform2f(u.uTexel, texel[0], texel[1])
    this.setTex(u.uVelocity, this.velocity.read.tex, 0)
    this.setTex(u.uCurl, this.curlFbo.tex, 1)
    gl.uniform1f(u.uCurlStrength, this.opts.curl)
    gl.uniform1f(u.uDt, dt)
    this.drawQuad()
    this.velocity.swap()

    // 発散 → 圧力 → 勾配減算
    u = this.use(this.pDiv)
    this.bind(this.divergence)
    gl.uniform2f(u.uTexel, texel[0], texel[1])
    this.setTex(u.uVelocity, this.velocity.read.tex, 0)
    this.setTex(u.uMask, this.maskTex, 1)
    this.drawQuad()

    u = this.use(this.pPress)
    gl.uniform2f(u.uTexel, texel[0], texel[1])
    for (let i = 0; i < this.opts.pressureIters; i++) {
      this.bind(this.pressure.write)
      this.setTex(u.uPressure, this.pressure.read.tex, 0)
      this.setTex(u.uDivergence, this.divergence.tex, 1)
      this.drawQuad()
      this.pressure.swap()
    }

    u = this.use(this.pGrad)
    this.bind(this.velocity.write)
    gl.uniform2f(u.uTexel, texel[0], texel[1])
    this.setTex(u.uPressure, this.pressure.read.tex, 0)
    this.setTex(u.uVelocity, this.velocity.read.tex, 1)
    this.setTex(u.uMask, this.maskTex, 2)
    this.drawQuad()
    this.velocity.swap()

    // 染料の移流
    u = this.use(this.pAdvect)
    this.bind(this.dye.write)
    gl.uniform2f(u.uTexel, texel[0], texel[1]) // 速度サンプル基準（速度場texel）
    this.setTex(u.uVelocity, this.velocity.read.tex, 0)
    this.setTex(u.uSource, this.dye.read.tex, 1)
    this.setTex(u.uMask, this.maskTex, 2)
    gl.uniform1f(u.uDt, dt)
    gl.uniform1f(u.uDissipation, this.opts.dyeDissipation)
    this.drawQuad()
    this.dye.swap()
  }

  /** 染料場を低解像度で読み戻す（灯籠の点灯判定用）。戻り値: RGBA8 配列（probeW×probeH、上下は画面座標に合わせ済み） */
  readProbe(): Uint8Array {
    const gl = this.gl
    const u = this.use(this.pProbe)
    this.bind(this.probeFbo)
    gl.uniform2f(u.uTexel, 1 / this.dyeW, 1 / this.dyeH)
    this.setTex(u.uDye, this.dye.read.tex, 0)
    this.drawQuad()
    gl.readPixels(0, 0, this.probeW, this.probeH, gl.RGBA, gl.UNSIGNED_BYTE, this.probeBuf)
    return this.probeBuf
  }
  /** 画面座標(0..1, y下向き)の染料RGBを 0..1 で返す（直近の readProbe の結果から） */
  probeAt(x: number, y: number): [number, number, number] {
    const px = Math.max(0, Math.min(this.probeW - 1, Math.floor(x * this.probeW)))
    const py = Math.max(0, Math.min(this.probeH - 1, Math.floor((1 - y) * this.probeH)))
    const i = (py * this.probeW + px) * 4
    return [this.probeBuf[i] / 255, this.probeBuf[i + 1] / 255, this.probeBuf[i + 2] / 255]
  }

  render() {
    const gl = this.gl
    const u = this.use(this.pDisplay)
    this.bind(null)
    gl.uniform2f(u.uTexel, 1 / this.dyeW, 1 / this.dyeH)
    this.setTex(u.uDye, this.dye.read.tex, 0)
    this.setTex(u.uMask, this.maskTex, 1)
    gl.uniform3f(u.uBg, this.opts.bg[0], this.opts.bg[1], this.opts.bg[2])
    this.drawQuad()
  }

  /** 場を全消去（レベル切替用） */
  clear() {
    const gl = this.gl
    for (const f of [this.velocity.read, this.velocity.write, this.dye.read, this.dye.write, this.pressure.read, this.pressure.write]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb)
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }
  }
}
