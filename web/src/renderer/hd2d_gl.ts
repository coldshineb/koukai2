// renderer/hd2d_gl.ts — WebGL2《八方旅人》风格 HD-2D 实时光影与材质引擎
// 管线结构：
//   Pass 1 (MRT G-Buffer): 2.5D 微距透视地形查表 + 无溢出 64x64 贴图采样 + 立体主角/NPC 公告板与脚底软影
//   Pass 2 (PBR 光照与水面): 切线空间凹凸法线、屏幕空间太阳方向投影、Contact AO、动态波纹/平面水面倒影/高光闪烁、黄昏/夜窗暖灯火溢光、体积光柱与飘浮微尘粒子
//   Pass 3 & 4 (Bloom + Tilt-Shift): 1/4 分辨率 HDR 泛光提取与双向高斯模糊 + 上下移轴景深微距虚化 + ACES 电影级色调映射

export interface Hd2dSprite {
  spriteIdx: number;
  xPx: number;
  yPx: number;
  w: number;
  h: number;
  sortY: number;
  isHero: boolean;
}

export interface Hd2dRenderParams {
  vw: number;
  vh: number;
  mapBytes: Uint8Array;
  mapW: number;
  mapH: number;
  camPxX: number;
  camPxY: number;
  tilePx: number;
  timeSec: number;
  gameTime: number;
  mode: string;
  fade: number;
  heroScreenX: number;
  heroScreenY: number;
  albSheet: HTMLImageElement;
  nrmSheet: HTMLImageElement;
  matSheet: HTMLImageElement;
  charsAlb: HTMLImageElement;
  charsNrm: HTMLImageElement;
  sheetCols: number;
  sheetRows: number;
  charsCols: number;
  charsRows: number;
  sprites: Hd2dSprite[];
}

interface TexEntry {
  tex: WebGLTexture;
  imgRef: HTMLImageElement | Uint8Array | null;
  ver?: number;
}

const VS_QUAD = `#version 300 es
precision highp float;
out vec2 vUV;
void main() {
  vec2 pos = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
  vUV = pos * 0.5 + 0.5;
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

// Pass 1A: 2.5D 微妙透视查表全屏片元渲染港口地形与建筑 (0 接缝，0 图集渗色)
const FS_TERRAIN_GBUF = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
in vec2 vUV;

uniform usampler2D uMapTex;
uniform sampler2D uAlbTex;
uniform sampler2D uNrmTex;
uniform sampler2D uMatTex;
uniform vec2 uViewSize;
uniform vec2 uCamPx;
uniform vec2 uMapSize;
uniform vec2 uAtlasGrid;
uniform float uTilePx;
uniform float uTiltStrength;

layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outNrmHeight;
layout(location = 2) out vec4 outMat;

void main() {
  // vUV.y = 0 在画面底部, 1 在画面顶部; 做柔和 2.5D 微距透视缩放，保持角色中心区域 1:1 比例
  float dyNorm = vUV.y - 0.5;
  float persp = 1.0 / (1.0 - dyNorm * uTiltStrength);
  vec2 centeredPx = (vec2(vUV.x, 1.0 - vUV.y) - 0.5) * uViewSize;
  // 垂直轻微拉伸抵消压扁感，呈现立面饱满的 HD-2D 沙盘透视
  vec2 warpedPx = vec2(centeredPx.x * persp, centeredPx.y * mix(1.0, persp, 0.72)) + uViewSize * 0.5;
  vec2 worldPx = warpedPx + uCamPx;
  vec2 tileCoord = worldPx / uTilePx;

  ivec2 mapCell = clamp(ivec2(floor(tileCoord)), ivec2(0), ivec2(uMapSize) - 1);
  uint tileId = texelFetch(uMapTex, mapCell, 0).r;

  vec2 localUV = fract(tileCoord);
  // 半纹素钳位，并用连续 tileCoord 导数传给 textureGrad，彻底杜绝 fract 跳变引起的 1px Mipmap 接缝线
  vec2 padLocal = clamp(localUV, vec2(0.5 / 64.0), vec2(63.5 / 64.0));
  float col = float(tileId % uint(uAtlasGrid.x));
  float row = float(tileId / uint(uAtlasGrid.x));
  vec2 atlasUV = (vec2(col, row) + padLocal) / uAtlasGrid;
  vec2 dUVdx = dFdx(tileCoord) / uAtlasGrid;
  vec2 dUVdy = dFdy(tileCoord) / uAtlasGrid;

  vec4 alb = textureGrad(uAlbTex, atlasUV, dUVdx, dUVdy);
  vec4 nrm = textureGrad(uNrmTex, atlasUV, dUVdx, dUVdy);
  vec4 mat = textureGrad(uMatTex, atlasUV, dUVdx, dUVdy);

  outColor = vec4(alb.rgb, 1.0);
  outNrmHeight = nrm;
  outMat = mat;
}`;

// Pass 1B: 角色阴影与直立 2.5D 公告板绘制
const VS_SPRITE = `#version 300 es
precision highp float;
in vec2 aQuad;
uniform vec2 uViewSize;
uniform vec4 uRect; // x, y, w, h (top-left origin pixels)
uniform vec4 uUvRect;
uniform float uTiltStrength;
uniform float uIsShadow;
uniform vec2 uShadowShear;

out vec2 vTexUV;

void main() {
  // 精确反解 2.5D 透视变换，确保角色脚底与阴影严格贴合所在格子
  float footX = uRect.x + uRect.z * 0.5;
  float footY = uRect.y + uRect.w - 3.0;
  float ys = footY;
  for (int it = 0; it < 3; it++) {
    float dy = 0.5 - ys / uViewSize.y;
    float p = 1.0 / (1.0 - dy * uTiltStrength);
    float sy = mix(1.0, p, 0.72);
    ys = uViewSize.y * 0.5 + (footY - uViewSize.y * 0.5) / sy;
  }
  float dyF = 0.5 - ys / uViewSize.y;
  float perspF = 1.0 / (1.0 - dyF * uTiltStrength);
  float xs = uViewSize.x * 0.5 + (footX - uViewSize.x * 0.5) / perspF;
  vec2 projFoot = vec2(xs, ys);

  float invPersp = 1.0 / perspF;
  float scaleW = mix(1.0, invPersp, 0.45);
  float scaleH = mix(1.0, invPersp, 0.28);

  vec2 localOffset;
  if (uIsShadow > 0.5) {
    float up = 1.0 - aQuad.y;
    localOffset = vec2(
      (aQuad.x - 0.5) * uRect.z * scaleW * 0.65 + up * uShadowShear.x * uRect.z,
      up * uShadowShear.y * uRect.w * 0.34
    );
  } else {
    localOffset = vec2(
      (aQuad.x - 0.5) * uRect.z * scaleW,
      (aQuad.y - 1.0) * uRect.w * scaleH
    );
  }

  vec2 px = projFoot + localOffset;
  vec2 ndc = vec2(px.x / uViewSize.x * 2.0 - 1.0, 1.0 - px.y / uViewSize.y * 2.0);
  gl_Position = vec4(ndc, 0.0, 1.0);
  vTexUV = mix(uUvRect.xy, uUvRect.zw, aQuad);
}`;

const FS_SPRITE = `#version 300 es
precision highp float;
in vec2 vTexUV;
uniform sampler2D uCharsAlb;
uniform sampler2D uCharsNrm;
uniform float uIsShadow;

layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outNrmHeight;
layout(location = 2) out vec4 outMat;

void main() {
  vec4 alb = texture(uCharsAlb, vTexUV);
  if (alb.a < 0.25) discard;
  if (uIsShadow > 0.5) {
    // 软接地阴影写入暗化与极弱遮蔽 (不改地形高程/水面)
    outColor = vec4(0.06, 0.08, 0.14, alb.a * 0.38);
    outNrmHeight = vec4(0.5, 0.5, 1.0, 0.0);
    outMat = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }
  vec4 nrm = texture(uCharsNrm, vTexUV);
  outColor = vec4(alb.rgb, alb.a);
  outNrmHeight = vec4(nrm.rgb, 0.78);
  outMat = vec4(0.0, 0.0, 0.25, alb.a);
}`;

// Pass 2: 《八方旅人》核心实时光影、太阳斜射投影、Contact AO、动态波光水面反射、灯火溢光、体积光束与微尘粒子
const FS_HD2D_LIGHT = `#version 300 es
precision highp float;
in vec2 vUV;

uniform sampler2D uColorTex;
uniform sampler2D uNrmTex;
uniform sampler2D uMatTex;
uniform vec2 uViewSize;
uniform vec2 uCamPx;
uniform float uTimeSec;
uniform float uGameTime; // 0..71
uniform float uNightMix;
uniform float uDawnMix;
uniform float uDuskMix;
uniform float uOvercastMix;
uniform vec2 uHeroUv;

out vec4 fragColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec3 evalWaveNormal(vec2 worldPx, float t) {
  vec2 p1 = worldPx * 0.055 + vec2(t * 0.48, t * 0.22);
  vec2 p2 = worldPx * 0.115 + vec2(-t * 0.36, t * 0.52);
  float eps = 0.08;
  float h0 = sin(p1.x + 1.2 * vnoise(p1 * 0.40)) * 0.55 + cos(p2.y - p2.x * 0.65) * 0.45 + vnoise(p2) * 0.45;
  float hx = sin(p1.x + eps + 1.2 * vnoise(p1 * 0.40 + vec2(eps, 0.0))) * 0.55 + cos(p2.y - (p2.x + eps) * 0.65) * 0.45 + vnoise(p2 + vec2(eps, 0.0)) * 0.45;
  float hy = sin(p1.x + 1.2 * vnoise(p1 * 0.40 + vec2(0.0, eps))) * 0.55 + cos(p2.y + eps - p2.x * 0.65) * 0.45 + vnoise(p2 + vec2(0.0, eps)) * 0.45;
  vec2 grad = vec2(hx - h0, hy - h0) / eps;
  return normalize(vec3(-grad.x * 0.14, -grad.y * 0.14, 1.0));
}

void main() {
  vec4 baseCol = texture(uColorTex, vUV);
  vec4 nrmH = texture(uNrmTex, vUV);
  vec4 mat = texture(uMatTex, vUV);

  vec3 N = normalize(nrmH.rgb * 2.0 - 1.0);
  float elev = nrmH.a;
  float isWater = mat.r;
  float emissive = mat.g;
  float specStr = mat.b;

  // 计算太阳 / 月亮方位与光色（vUV.y 朝上：+y 光从上方照下，与原作右侧光照/左侧暗影对齐）
  vec3 sunDirDay = normalize(vec3(0.56, 0.52, 0.64));
  vec3 sunDirDawn = normalize(vec3(0.84, 0.34, 0.42));
  vec3 sunDirDusk = normalize(vec3(-0.86, 0.32, 0.38));
  vec3 sunDirNight = normalize(vec3(-0.48, 0.52, 0.70));
  vec3 sunDir = normalize(
    sunDirDay * max(0.0, 1.0 - uDawnMix - uDuskMix - uNightMix)
    + sunDirDawn * uDawnMix
    + sunDirDusk * uDuskMix
    + sunDirNight * uNightMix
  );

  vec3 sunCol = mix(vec3(1.16, 1.07, 0.92), vec3(1.22, 0.74, 0.54), uDawnMix);
  sunCol = mix(sunCol, vec3(1.36, 0.70, 0.32), uDuskMix);
  sunCol = mix(sunCol, vec3(0.20, 0.34, 0.68), uNightMix);
  sunCol = mix(sunCol, vec3(0.70, 0.78, 0.90), uOvercastMix * 0.75);

  vec3 skyAmb = mix(vec3(0.35, 0.41, 0.53), vec3(0.30, 0.28, 0.44), uDawnMix);
  skyAmb = mix(skyAmb, vec3(0.26, 0.20, 0.38), uDuskMix);
  skyAmb = mix(skyAmb, vec3(0.055, 0.085, 0.19), uNightMix);
  skyAmb = mix(skyAmb, vec3(0.32, 0.37, 0.46), uOvercastMix * 0.65);

  vec2 texel = 1.0 / uViewSize;

  // 1. 屏幕空间太阳斜向阴影光线步进 (屋顶/石墙/船身投射长影子到广场与海面)
  float sunShadow = 1.0;
  if (elev < 0.36 && uOvercastMix < 0.85) {
    vec2 rayStep = vec2(sunDir.x, sunDir.y) * texel * 5.2;
    float hitAccum = 0.0;
    for (int s = 1; s <= 12; s++) {
      float fs = float(s);
      vec2 suv = clamp(vUV + rayStep * fs, vec2(0.002), vec2(0.998));
      float sh = texture(uNrmTex, suv).a;
      float needed = elev + fs * 0.052;
      if (sh > needed && sh > 0.50) {
        hitAccum += (1.0 - fs / 13.0) * 0.42;
      }
    }
    sunShadow = clamp(1.0 - hitAccum * mix(1.0, 0.45, uOvercastMix), 0.24, 1.0);
  }

  // 2. 接触环境光遮蔽 (Contact AO): 让墙脚、台阶、行道树与码头边缘厚重立体
  float ao = 1.0;
  if (elev < 0.30) {
    float occ = 0.0;
    for (int k = 0; k < 8; k++) {
      float ang = float(k) * 0.785398;
      vec2 off = vec2(cos(ang), sin(ang)) * texel * 7.5;
      float nh = texture(uNrmTex, clamp(vUV + off, vec2(0.002), vec2(0.998))).a;
      occ += max(0.0, nh - elev) * 0.13;
    }
    ao = clamp(1.0 - occ, 0.56, 1.0);
  }

  vec3 viewDir = normalize(vec3(0.0, -0.25, 1.0));
  vec3 albedo = pow(max(baseCol.rgb, vec3(0.001)), vec3(1.12));

  vec3 lit;
  if (isWater > 0.35) {
    // 3. 动态《八方旅人》级高清海水：世界坐标锚定波浪法线 + 真实岸边倒影 + 细腻碎钻水光
    vec2 worldPx = vec2(vUV.x * uViewSize.x, (1.0 - vUV.y) * uViewSize.y) + uCamPx;
    vec3 wN = evalWaveNormal(worldPx, uTimeSec);
    vec3 surfN = normalize(mix(N, wN, 0.92));

    // 开阔深水采用连续均匀海水基色，消除 16x16 原版水域接缝微线，同时保留岸边浅水过渡
    float deepMask = smoothstep(0.45, 0.95, isWater);
    vec3 pureOcean = vec3(0.032, 0.165, 0.42);
    vec3 oceanAlbedo = mix(albedo, pureOcean, deepMask * 0.82);

    // 平面反射采样上方岸堤/船只/灯火
    vec2 reflOffset = vec2(surfN.x * 0.016, 0.048 + surfN.y * 0.012);
    vec2 reflUV = clamp(vUV + reflOffset, vec2(0.004), vec2(0.996));
    vec3 reflCol = texture(uColorTex, reflUV).rgb;
    float reflMatWater = texture(uMatTex, reflUV).r;
    float reflEm = texture(uMatTex, reflUV).g;

    vec3 skyRefl = mix(vec3(0.24, 0.52, 0.86), vec3(0.92, 0.52, 0.34), uDuskMix);
    skyRefl = mix(skyRefl, vec3(0.84, 0.62, 0.70), uDawnMix);
    skyRefl = mix(skyRefl, vec3(0.045, 0.085, 0.19), uNightMix);
    vec3 envRefl = mix(reflCol * mix(0.68, 0.36, uNightMix), skyRefl, clamp(reflMatWater * 0.85 + 0.38, 0.34, 0.90));
    envRefl += vec3(1.15, 0.66, 0.22) * reflEm * (uNightMix * 1.1 + uDuskMix * 0.55);

    // 水面高光严格锁定极陡波峰（细碎星芒而非大块白斑）
    vec3 waterLightDir = normalize(vec3(sunDir.x * 0.75, 0.72, 0.42));
    vec3 waterHalf = normalize(waterLightDir + vec3(0.0, -0.35, 1.0));
    float specBase = max(dot(wN, waterHalf), 0.0);
    float sparkle = pow(specBase, 220.0) * 3.2;
    float waveCrest = smoothstep(0.92, 0.995, specBase) * 0.45;
    float glintScale = mix(0.85, 0.42, uNightMix) * (1.0 - 0.75 * uOvercastMix);

    float ndotl = max(dot(surfN, sunDir), 0.0);
    float fresnel = pow(1.0 - max(dot(surfN, viewDir), 0.0), 2.6) * 0.42 + 0.14;
    vec3 waterBase = oceanAlbedo * (skyAmb * 1.25 + sunCol * ndotl * 0.68 * sunShadow) * ao;
    lit = mix(waterBase, envRefl, fresnel) + sunCol * (sparkle + waveCrest) * glintScale * sunShadow;
  } else {
    // 4. 固体地形与建筑：立体凹凸法线漫反射 + 微光泽高光 + 半球环境光 + 阴影
    float ndotl = max(dot(N, sunDir), 0.0);
    // 轻微背面边缘轮廓光（八方旅人主体感来源之一）
    float rim = pow(1.0 - max(dot(N, viewDir), 0.0), 2.2) * (0.14 + 0.18 * uDuskMix + 0.12 * uDawnMix);
    vec3 halfVec = normalize(sunDir + viewDir);
    float specPow = mix(12.0, 44.0, specStr);
    float spec = pow(max(dot(N, halfVec), 0.0), specPow) * specStr * 0.45;

    vec3 direct = sunCol * (ndotl * 0.95 + spec) * sunShadow;
    vec3 ambient = skyAmb * (0.78 + 0.22 * N.z) * ao + vec3(0.08, 0.06, 0.04) * max(0.0, -N.y) * ao;
    lit = albedo * (ambient + direct) + sunCol * rim * sunShadow;
  }

  // 5. 黄昏与夜晚：暖色发光窗户灯火 + 周边砖路暖光溢散 + 主角提灯照明
  float lanternPhase = uNightMix * 1.0 + uDuskMix * 0.52 + uDawnMix * 0.25;
  if (lanternPhase > 0.02) {
    float flicker = 0.93 + 0.07 * sin(uTimeSec * 4.5 + vUV.x * 40.0 + vUV.y * 30.0);
    // 窗户本体发暖橙金光 (触发 Pass 3 HDR Bloom)
    lit += vec3(1.55, 0.92, 0.34) * emissive * lanternPhase * flicker;

    // 9-tap 窗户暖灯溢光到附近墙壁与地砖
    float spill = 0.0;
    for (int i = -1; i <= 1; i++) {
      for (int j = -1; j <= 1; j++) {
        vec2 suv = clamp(vUV + vec2(float(i), float(j)) * texel * 22.0, vec2(0.002), vec2(0.998));
        spill += texture(uMatTex, suv).g;
      }
    }
    lit += albedo * vec3(1.15, 0.68, 0.28) * (spill / 9.0) * lanternPhase * 1.35 * flicker;

    // 玩家身边柔和便携提灯暖光圈
    vec2 dHero = (vUV - uHeroUv) * vec2(uViewSize.x / uViewSize.y, 1.0);
    float heroGlow = exp(-dot(dHero, dHero) * 32.0) * (uNightMix * 1.05 + uDuskMix * 0.28);
    lit += albedo * vec3(1.35, 0.86, 0.42) * heroGlow;
  }

  // 6. 大气斜向体积阳光束 (God Rays) & 稀疏柔光浮尘粒子
  if (uNightMix < 0.85 && uOvercastMix < 0.8) {
    float rayCoord = (vUV.x * 0.72 + (1.0 - vUV.y) * 0.55) * 9.0 - uTimeSec * 0.14;
    float shafts = pow(max(0.0, sin(rayCoord) * 0.5 + 0.5), 3.0) * vnoise(vec2(rayCoord * 1.3, uTimeSec * 0.18));
    float cornerMask = smoothstep(0.0, 0.85, vUV.y) * smoothstep(1.0, 0.1, vUV.x);
    vec3 rayCol = mix(vec3(0.45, 0.40, 0.28), vec3(0.65, 0.36, 0.16), uDuskMix);
    lit += rayCol * shafts * cornerMask * (0.14 - 0.10 * uNightMix);
  }

  // 稀疏微光浮尘 / 夜晚萤火 (仅少许柔和金点，避免满屏均匀雪点)
  vec2 pCoord = vUV * vec2(12.0, 7.0) + vec2(uTimeSec * 0.10, -uTimeSec * 0.06);
  vec2 cell = floor(pCoord);
  vec2 fcell = fract(pCoord);
  float rnd = hash21(cell);
  if (rnd > 0.89) {
    vec2 center = vec2(0.5) + 0.26 * vec2(sin(uTimeSec * 0.85 + rnd * 25.0), cos(uTimeSec * 0.65 + rnd * 19.0));
    float dist = length(fcell - center);
    float mote = smoothstep(0.075, 0.0, dist) * (0.35 + 0.65 * sin(uTimeSec * 2.0 + rnd * 30.0));
    vec3 moteCol = mix(vec3(1.10, 0.92, 0.58), vec3(1.30, 0.76, 0.26), uNightMix + uDuskMix * 0.5);
    lit += moteCol * mote * (0.16 + 0.34 * (uNightMix + uDuskMix));
  }

  // 半档 HDR 打包到 RGBA8 ([0..2.0] -> [0..1.0]), 让 Pass 3 Bloom 真实捕捉高光
  fragColor = vec4(clamp(lit * 0.5, 0.0, 1.0), 1.0);
}`;

// Pass 3: HDR 高光阈值抽取 & 双向高斯模糊 (Bloom)
const FS_BLOOM_EXTRACT = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uLitTex;
out vec4 fragColor;
void main() {
  vec3 c = texture(uLitTex, vUV).rgb * 2.0; // 解包 [0..2] HDR
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float soft = smoothstep(0.68, 1.25, lum);
  fragColor = vec4(c * soft * 0.5, 1.0);
}`;

const FS_BLOOM_BLUR = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uDir; // texel * dir
out vec4 fragColor;
void main() {
  vec3 acc = texture(uTex, vUV).rgb * 0.227027;
  acc += texture(uTex, vUV + uDir * 1.384615).rgb * 0.316216;
  acc += texture(uTex, vUV - uDir * 1.384615).rgb * 0.316216;
  acc += texture(uTex, vUV + uDir * 3.230769).rgb * 0.070270;
  acc += texture(uTex, vUV - uDir * 3.230769).rgb * 0.070270;
  fragColor = vec4(acc, 1.0);
}`;

// Pass 4: 最终合成 (移轴微距 Tilt-Shift DoF + HDR Bloom 叠加 + ACES Filmic 胶片曲线 + 渐隐淡出 + 暗角)
const FS_FINAL = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uLitTex;
uniform sampler2D uBloomTex;
uniform vec2 uViewSize;
uniform float uFade;
uniform float uDofStrength;

out vec4 fragColor;

vec3 acesFilm(vec3 x) {
  float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  // 八方旅人招牌移轴景深：上下边缘柔化如微缩沙盘，中景焦点区 100% 锐利！
  float focusDist = max(0.0, abs(vUV.y - 0.50) - 0.22) / 0.28;
  float coc = smoothstep(0.0, 1.0, focusDist) * uDofStrength;

  vec3 hdr;
  if (coc > 0.02) {
    vec2 rad = (coc * 2.6) / uViewSize;
    vec3 sum = texture(uLitTex, vUV).rgb;
    sum += texture(uLitTex, vUV + vec2(rad.x, 0.0)).rgb;
    sum += texture(uLitTex, vUV - vec2(rad.x, 0.0)).rgb;
    sum += texture(uLitTex, vUV + vec2(0.0, rad.y)).rgb;
    sum += texture(uLitTex, vUV - vec2(0.0, rad.y)).rgb;
    sum += texture(uLitTex, vUV + vec2(rad.x, rad.y) * 0.7).rgb;
    sum += texture(uLitTex, vUV + vec2(-rad.x, rad.y) * 0.7).rgb;
    sum += texture(uLitTex, vUV + vec2(rad.x, -rad.y) * 0.7).rgb;
    sum += texture(uLitTex, vUV + vec2(-rad.x, -rad.y) * 0.7).rgb;
    hdr = (sum / 9.0) * 2.0;
  } else {
    hdr = texture(uLitTex, vUV).rgb * 2.0;
  }

  vec3 bloom = texture(uBloomTex, vUV).rgb * 2.0;
  hdr += bloom * 0.62;

  // ACES Filmic 色调映射 + 电影级微暗角
  vec3 mapped = acesFilm(hdr * 1.08);
  // 微弱 S 型质感对比与暖高光微润色
  mapped = mix(mapped, mapped * mapped * (3.0 - 2.0 * mapped), 0.18);

  vec2 vig = vUV - 0.5;
  float vigMul = 1.0 - dot(vig, vig) * 0.42;
  mapped *= clamp(vigMul, 0.65, 1.0) * uFade;

  fragColor = vec4(mapped, 1.0);
}`;

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`HD2D Shader compile error: ${log}`);
  }
  return s;
}

function linkProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const p = gl.createProgram()!;
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(`HD2D Program link error: ${log}`);
  }
  return p;
}

function createRgbaTex(gl: WebGL2RenderingContext, w: number, h: number, linear: boolean): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, linear ? gl.LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

export class Hd2dPortRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  private vw = 0;
  private vh = 0;
  private vao: WebGLVertexArrayObject;
  private spriteVao: WebGLVertexArrayObject;

  private progTerrain: WebGLProgram;
  private progSprite: WebGLProgram;
  private progLight: WebGLProgram;
  private progBloomExt: WebGLProgram;
  private progBloomBlur: WebGLProgram;
  private progFinal: WebGLProgram;

  private fboGbuf: WebGLFramebuffer | null = null;
  private texGCol: WebGLTexture | null = null;
  private texGNrm: WebGLTexture | null = null;
  private texGMat: WebGLTexture | null = null;

  private fboLit: WebGLFramebuffer | null = null;
  private texLit: WebGLTexture | null = null;

  private fboBloomA: WebGLFramebuffer | null = null;
  private texBloomA: WebGLTexture | null = null;
  private fboBloomB: WebGLFramebuffer | null = null;
  private texBloomB: WebGLTexture | null = null;

  private texMap: WebGLTexture;
  private mapHash = 0;
  private imgTexCache = new Map<string, TexEntry>();

  constructor() {
    this.canvas = document.createElement("canvas");
    const gl = this.canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;

    this.vao = gl.createVertexArray()!;
    this.spriteVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.spriteVao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.progTerrain = linkProgram(gl, VS_QUAD, FS_TERRAIN_GBUF);
    this.progSprite = linkProgram(gl, VS_SPRITE, FS_SPRITE);
    this.progLight = linkProgram(gl, VS_QUAD, FS_HD2D_LIGHT);
    this.progBloomExt = linkProgram(gl, VS_QUAD, FS_BLOOM_EXTRACT);
    this.progBloomBlur = linkProgram(gl, VS_QUAD, FS_BLOOM_BLUR);
    this.progFinal = linkProgram(gl, VS_QUAD, FS_FINAL);

    this.texMap = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texMap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private ensureTargets(vw: number, vh: number) {
    if (this.vw === vw && this.vh === vh && this.fboGbuf) return;
    const gl = this.gl;
    this.vw = vw;
    this.vh = vh;
    this.canvas.width = vw;
    this.canvas.height = vh;

    const delTex = (t: WebGLTexture | null) => { if (t) gl.deleteTexture(t); };
    const delFbo = (f: WebGLFramebuffer | null) => { if (f) gl.deleteFramebuffer(f); };
    delTex(this.texGCol); delTex(this.texGNrm); delTex(this.texGMat); delFbo(this.fboGbuf);
    delTex(this.texLit); delFbo(this.fboLit);
    delTex(this.texBloomA); delFbo(this.fboBloomA);
    delTex(this.texBloomB); delFbo(this.fboBloomB);

    this.texGCol = createRgbaTex(gl, vw, vh, true);
    this.texGNrm = createRgbaTex(gl, vw, vh, true);
    this.texGMat = createRgbaTex(gl, vw, vh, true);
    this.fboGbuf = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboGbuf);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texGCol, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.texGNrm, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, this.texGMat, 0);

    this.texLit = createRgbaTex(gl, vw, vh, true);
    this.fboLit = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboLit);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texLit, 0);

    const bw = Math.max(64, Math.floor(vw / 4));
    const bh = Math.max(64, Math.floor(vh / 4));
    this.texBloomA = createRgbaTex(gl, bw, bh, true);
    this.fboBloomA = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboBloomA);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texBloomA, 0);

    this.texBloomB = createRgbaTex(gl, bw, bh, true);
    this.fboBloomB = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboBloomB);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texBloomB, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private getImageTex(key: string, img: HTMLImageElement, linear: boolean): WebGLTexture {
    const gl = this.gl;
    let ent = this.imgTexCache.get(key);
    if (!ent || ent.imgRef !== img) {
      const tex = ent?.tex ?? gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, linear ? gl.LINEAR : gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      ent = { tex, imgRef: img };
      this.imgTexCache.set(key, ent);
    }
    return ent.tex;
  }

  private syncMapTexture(mapBytes: Uint8Array, mapW: number, mapH: number) {
    const gl = this.gl;
    let h = 2166136261 >>> 0;
    for (let i = 0; i < mapBytes.length; i++) {
      h = Math.imul(h ^ mapBytes[i], 16777619);
    }
    if (h === this.mapHash) return;
    this.mapHash = h;
    gl.bindTexture(gl.TEXTURE_2D, this.texMap);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, mapW, mapH, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, mapBytes);
  }

  render(p: Hd2dRenderParams): HTMLCanvasElement {
    const gl = this.gl;
    this.ensureTargets(p.vw, p.vh);
    this.syncMapTexture(p.mapBytes, p.mapW, p.mapH);

    const albTex = this.getImageTex("alb", p.albSheet, true);
    const nrmTex = this.getImageTex("nrm", p.nrmSheet, true);
    const matTex = this.getImageTex("mat", p.matSheet, true);
    const chAlbTex = this.getImageTex("chAlb", p.charsAlb, true);
    const chNrmTex = this.getImageTex("chNrm", p.charsNrm, true);

    const tiltStrength = 0.14;

    // ---- Pass 1: MRT G-Buffer ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboGbuf);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
    gl.viewport(0, 0, p.vw, p.vh);
    gl.disable(gl.BLEND);

    gl.useProgram(this.progTerrain);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texMap);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, albTex);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, nrmTex);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, matTex);
    gl.uniform1i(gl.getUniformLocation(this.progTerrain, "uMapTex"), 0);
    gl.uniform1i(gl.getUniformLocation(this.progTerrain, "uAlbTex"), 1);
    gl.uniform1i(gl.getUniformLocation(this.progTerrain, "uNrmTex"), 2);
    gl.uniform1i(gl.getUniformLocation(this.progTerrain, "uMatTex"), 3);
    gl.uniform2f(gl.getUniformLocation(this.progTerrain, "uViewSize"), p.vw, p.vh);
    gl.uniform2f(gl.getUniformLocation(this.progTerrain, "uCamPx"), p.camPxX, p.camPxY);
    gl.uniform2f(gl.getUniformLocation(this.progTerrain, "uMapSize"), p.mapW, p.mapH);
    gl.uniform2f(gl.getUniformLocation(this.progTerrain, "uAtlasGrid"), p.sheetCols, p.sheetRows);
    gl.uniform1f(gl.getUniformLocation(this.progTerrain, "uTilePx"), p.tilePx);
    gl.uniform1f(gl.getUniformLocation(this.progTerrain, "uTiltStrength"), tiltStrength);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ---- Pass 1B: 角色地面阴影与直立角色精灵 ----
    const sorted = [...p.sprites].sort((a, b) => a.sortY - b.sortY);
    if (sorted.length > 0) {
      gl.useProgram(this.progSprite);
      gl.bindVertexArray(this.spriteVao);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, chAlbTex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, chNrmTex);
      gl.uniform1i(gl.getUniformLocation(this.progSprite, "uCharsAlb"), 0);
      gl.uniform1i(gl.getUniformLocation(this.progSprite, "uCharsNrm"), 1);
      gl.uniform2f(gl.getUniformLocation(this.progSprite, "uViewSize"), p.vw, p.vh);
      gl.uniform1f(gl.getUniformLocation(this.progSprite, "uTiltStrength"), tiltStrength);

      const shadowShiftX = p.mode === "dusk" ? 0.56 : p.mode === "dawn" ? -0.48 : -0.28;
      gl.uniform2f(gl.getUniformLocation(this.progSprite, "uShadowShear"), shadowShiftX, 0.42);

      const uRectLoc = gl.getUniformLocation(this.progSprite, "uRect");
      const uUvLoc = gl.getUniformLocation(this.progSprite, "uUvRect");
      const uShadowLoc = gl.getUniformLocation(this.progSprite, "uIsShadow");

      // 先画脚底软阴影 (仅对 COLOR_ATTACHMENT0 混色，不覆盖地形法线/高程)
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.uniform1f(uShadowLoc, 1.0);
      for (const sp of sorted) {
        const col = sp.spriteIdx % p.charsCols;
        const row = Math.floor(sp.spriteIdx / p.charsCols);
        gl.uniform4f(uRectLoc, sp.xPx, sp.yPx, sp.w, sp.h);
        gl.uniform4f(uUvLoc, col / p.charsCols, row / p.charsRows, (col + 1) / p.charsCols, (row + 1) / p.charsRows);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }

      // 再画立体角色实体并写入法线/高程
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
      gl.uniform1f(uShadowLoc, 0.0);
      for (const sp of sorted) {
        const col = sp.spriteIdx % p.charsCols;
        const row = Math.floor(sp.spriteIdx / p.charsCols);
        gl.uniform4f(uRectLoc, sp.xPx, sp.yPx, sp.w, sp.h);
        gl.uniform4f(uUvLoc, col / p.charsCols, row / p.charsRows, (col + 1) / p.charsCols, (row + 1) / p.charsRows);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      gl.disable(gl.BLEND);
    }

    // ---- Pass 2: 光影 + 投影 + 动态水面倒影 + 暖灯火 + 体积光 + 微尘 ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboLit);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, p.vw, p.vh);
    gl.useProgram(this.progLight);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texGCol);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texGNrm);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.texGMat);
    gl.uniform1i(gl.getUniformLocation(this.progLight, "uColorTex"), 0);
    gl.uniform1i(gl.getUniformLocation(this.progLight, "uNrmTex"), 1);
    gl.uniform1i(gl.getUniformLocation(this.progLight, "uMatTex"), 2);
    gl.uniform2f(gl.getUniformLocation(this.progLight, "uViewSize"), p.vw, p.vh);
    gl.uniform2f(gl.getUniformLocation(this.progLight, "uCamPx"), p.camPxX, p.camPxY);
    gl.uniform1f(gl.getUniformLocation(this.progLight, "uTimeSec"), p.timeSec);
    gl.uniform1f(gl.getUniformLocation(this.progLight, "uGameTime"), p.gameTime);
    gl.uniform1f(gl.getUniformLocation(this.progLight, "uNightMix"), p.mode === "night" ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(this.progLight, "uDawnMix"), p.mode === "dawn" ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(this.progLight, "uDuskMix"), p.mode === "dusk" ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(this.progLight, "uOvercastMix"), p.mode === "overcast" ? 1 : 0);
    gl.uniform2f(gl.getUniformLocation(this.progLight, "uHeroUv"), p.heroScreenX / p.vw, 1.0 - p.heroScreenY / p.vh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ---- Pass 3: 1/4 分辨率 HDR Bloom ----
    const bw = Math.max(64, Math.floor(p.vw / 4));
    const bh = Math.max(64, Math.floor(p.vh / 4));
    gl.viewport(0, 0, bw, bh);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboBloomA);
    gl.useProgram(this.progBloomExt);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texLit);
    gl.uniform1i(gl.getUniformLocation(this.progBloomExt, "uLitTex"), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.useProgram(this.progBloomBlur);
    const uTexLoc = gl.getUniformLocation(this.progBloomBlur, "uTex");
    const uDirLoc = gl.getUniformLocation(this.progBloomBlur, "uDir");
    for (let pass = 0; pass < 2; pass++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboBloomB);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texBloomA);
      gl.uniform1i(uTexLoc, 0);
      gl.uniform2f(uDirLoc, (1.4 + pass * 1.1) / bw, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboBloomA);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texBloomB);
      gl.uniform1i(uTexLoc, 0);
      gl.uniform2f(uDirLoc, 0, (1.4 + pass * 1.1) / bh);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // ---- Pass 4: Tilt-Shift 微距景深 + Bloom + ACES 输出 ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, p.vw, p.vh);
    gl.useProgram(this.progFinal);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texLit);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texBloomA);
    gl.uniform1i(gl.getUniformLocation(this.progFinal, "uLitTex"), 0);
    gl.uniform1i(gl.getUniformLocation(this.progFinal, "uBloomTex"), 1);
    gl.uniform2f(gl.getUniformLocation(this.progFinal, "uViewSize"), p.vw, p.vh);
    gl.uniform1f(gl.getUniformLocation(this.progFinal, "uFade"), p.fade);
    gl.uniform1f(gl.getUniformLocation(this.progFinal, "uDofStrength"), 0.58);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    return this.canvas;
  }
}

let sharedHd2d: Hd2dPortRenderer | null = null;
let sharedFailed = false;

export function getSharedHd2dRenderer(): Hd2dPortRenderer | null {
  if (sharedFailed || typeof document === "undefined") return null;
  if (!sharedHd2d) {
    try {
      sharedHd2d = new Hd2dPortRenderer();
    } catch (e) {
      console.warn("WebGL2 HD-2D 初始化失败，自动回退 2D 高清管线:", e);
      sharedFailed = true;
      return null;
    }
  }
  return sharedHd2d;
}
