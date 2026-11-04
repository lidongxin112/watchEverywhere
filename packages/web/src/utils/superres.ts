/**
 * 视频超分（Anime4K 风格着色器，WebGL2 实现）
 *
 * 为什么用 WebGL2 而不是 WebGPU：WebGL2 在 Chrome / Edge / Safari 15+ 都可用，
 * 而且不依赖显卡驱动特性；着色器本身做的是「边缘保持放大 + 反锐化 + 平坦区降噪」，
 * 对动画/番剧这类线条清晰、色块大的片源提升最明显。
 *
 * 用法：
 *   const sr = new SuperResolver(video, canvas);
 *   await sr.start(2);      // 2 倍
 *   sr.setStrength(1.4);
 *   sr.stop();
 */

export type SuperResScale = 1.5 | 2 | 3;

const VERT = `#version 300 es
in vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uTexSize;
uniform vec2 uOutSize;
uniform float uStrength;   // 锐化强度
uniform float uDenoise;    // 平坦区降噪强度

out vec4 fragColor;

vec3 fetch(vec2 uv) {
  return texture(uTex, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uOutSize;
  vec2 px = 1.0 / uTexSize;

  vec3 c  = fetch(uv);
  vec3 l  = fetch(uv - vec2(px.x, 0.0));
  vec3 r  = fetch(uv + vec2(px.x, 0.0));
  vec3 up = fetch(uv - vec2(0.0, px.y));
  vec3 dn = fetch(uv + vec2(0.0, px.y));
  vec3 ld = fetch(uv - px);
  vec3 rd = fetch(uv + px);
  vec3 lu = fetch(uv + vec2(-px.x, px.y));
  vec3 ru = fetch(uv + vec2( px.x, -px.y));

  // 梯度：线条边缘越强，锐化越狠；平坦区交给降噪
  float gx = dot(abs(r - l), vec3(0.299, 0.587, 0.114));
  float gy = dot(abs(dn - up), vec3(0.299, 0.587, 0.114));
  float edge = clamp((gx + gy) * 6.0, 0.0, 1.0);

  // 3x3 高斯近似作为模糊基准
  vec3 blur = (l + r + up + dn) * 0.15 + (ld + rd + lu + ru) * 0.1 + c * 0.2;
  vec3 sharp = c + (c - blur) * uStrength;

  // 平坦区用邻域均值抑制噪点和色带
  vec3 flatColor = mix(c, blur, uDenoise * (1.0 - edge));

  vec3 outc = mix(flatColor, sharp, edge);

  // 轻微提对比度，避免放大后发灰
  outc = clamp((outc - 0.5) * 1.04 + 0.5, 0.0, 1.0);

  fragColor = vec4(outc, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`着色器编译失败：${log}`);
  }
  return sh;
}

export class SuperResolver {
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private texture: WebGLTexture | null = null;
  private vbo: WebGLBuffer | null = null;
  private raf = 0;
  private scale: SuperResScale = 2;
  private strength = 1.2;
  private denoise = 0.35;
  private running = false;
  private onFrame?: () => void;

  constructor(
    private video: HTMLVideoElement,
    private canvas: HTMLCanvasElement
  ) {}

  static supported(): boolean {
    try {
      const c = document.createElement('canvas');
      return !!c.getContext('webgl2');
    } catch {
      return false;
    }
  }

  get active() {
    return this.running;
  }

  async start(scale: SuperResScale = 2) {
    this.scale = scale;
    if (!this.gl) {
      const gl = this.canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance'
      });
      if (!gl) throw new Error('当前浏览器不支持 WebGL2，无法开启超分');
      this.gl = gl;

      const prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error(`着色器链接失败：${gl.getProgramInfoLog(prog)}`);
      }
      this.program = prog;

      const buf = gl.createBuffer();
      this.vbo = buf;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    this.running = true;
    this.loop();
  }

  setScale(scale: SuperResScale) {
    this.scale = scale;
  }

  setStrength(strength: number) {
    this.strength = strength;
  }

  setDenoise(denoise: number) {
    this.denoise = denoise;
  }

  /** 每帧回调，方便外部做统计/截图 */
  onEachFrame(fn: () => void) {
    this.onFrame = fn;
  }

  private resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.round(this.video.clientWidth * dpr));
    const h = Math.max(2, Math.round(this.video.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  private draw() {
    const gl = this.gl;
    const video = this.video;
    if (!gl || !this.program || !this.texture) return;
    if (!video.videoWidth || video.readyState < 2) return;

    this.resize();
    const w = this.canvas.width;
    const h = this.canvas.height;
    gl.viewport(0, 0, w, h);

    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, 'uTex'), 0);
    gl.uniform2f(gl.getUniformLocation(this.program, 'uTexSize'), video.videoWidth, video.videoHeight);
    gl.uniform2f(gl.getUniformLocation(this.program, 'uOutSize'), w, h);
    gl.uniform1f(gl.getUniformLocation(this.program, 'uStrength'), this.strength);
    gl.uniform1f(gl.getUniformLocation(this.program, 'uDenoise'), this.denoise);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.onFrame?.();
  }

  private loop() {
    if (!this.running) return;
    const v = this.video as any;
    if (typeof v.requestVideoFrameCallback === 'function') {
      v.requestVideoFrameCallback(() => {
        this.draw();
        this.loop();
      });
    } else {
      this.raf = requestAnimationFrame(() => {
        this.draw();
        this.loop();
      });
    }
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  destroy() {
    this.stop();
    const gl = this.gl;
    if (gl) {
      if (this.texture) gl.deleteTexture(this.texture);
      if (this.vbo) gl.deleteBuffer(this.vbo);
      if (this.program) gl.deleteProgram(this.program);
    }
    this.gl = null;
    this.texture = null;
    this.program = null;
    this.vbo = null;
  }
}
