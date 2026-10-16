// GMSL3 两跳视频链路台架：摄像头 → SER1 → 通道 A → DES1 → 控制器 → SER2 → 通道 B → DES2 → 屏幕
// node build.mjs [--light] [--audit]
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SEGMENTS } from "./info.mjs";
import { LINK, ilPinToPin } from "./model.mjs";

const SKILL = process.env.ANATOMY ?? join(homedir(), ".claude/skills/anatomy");
const use = (p) => import(pathToFileURL(join(SKILL, p)).href);
const k = await use("kit/iso-kit.mjs");
const G = await use("kit/lathe.mjs");
const { tubePieces, tubeSvg } = await use("kit/tube.mjs");
const A = await use("kit/audit.mjs");
const { kitScript } = await use("scripts/inline-kit.mjs");

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME = process.argv.includes("--dark") ? "dark" : "light";

const W = 1040;
const H = 470;
const PLATE = { x: -244, y: -98, w: 488, d: 184, r: 10 };
const PLATE_H = 10;
const FOOT_H = 5;

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [-236, -94, 64], [143, -46, 82], [227, -46, 82]],
  W,
  H,
  { pad: 22, azimuth: 74, elevation: 30 },
);
const V = G.viewOf(P);
const KS = G.scaleOf(P);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (points, style) => k.dotsSvg(points, style);
const path3 = (points, closed = false) => k.pathOf(points.map(at), closed);
const f2 = (v) => Math.round(v * 100) / 100;

const R = A.recorder(P);
const record = R.solid;
function put(name, ref, svg, shapes = [], { bias = 0, seg, ...rest } = {}) {
  const attrs = (rest.attrs ?? "") + (seg ? ` data-seg="${seg}"` : "");
  return R.put({ name, at: ref, bias, svg, shapes, piece: "bench", ...rest, attrs });
}

// ---------- 通用零件 ----------
const signed = (poly) => poly.reduce((a, [x, y], i) => {
  const [x2, y2] = poly[(i + 1) % poly.length];
  return a + x * y2 - x2 * y;
}, 0);
const screenOriented = (pts) => (signed(pts) < 0 ? [...pts].reverse() : pts);
function runsOfFlags(flags, want) {
  const count = flags.length;
  const runs = [];
  const start = flags.findIndex((flag, index) => flag !== flags[(index + count - 1) % count]);
  if (start < 0) return flags[0] === want ? [Array.from({ length: count + 1 }, (_, index) => index % count)] : [];
  let run = null;
  for (let step = 0; step < count; step++) {
    const index = (start + step) % count;
    if (flags[index] === want) {
      if (!run) run = [index];
      run.push((index + 1) % count);
    } else if (run) {
      runs.push(run);
      run = null;
    }
  }
  if (run) runs.push(run);
  return runs;
}
function prismPaths(F, poly, s0, s1) {
  const ring = signed(poly) > 0 ? poly : [...poly].reverse();
  const n = ring.length;
  const W3 = (s, [x, y]) => [F.o[0] + F.a[0] * s + F.u[0] * x + F.v[0] * y, F.o[1] + F.a[1] * s + F.u[1] * x + F.v[1] * y, F.o[2] + F.a[2] * s + F.u[2] * x + F.v[2] * y];
  const capNear = G.dot3(F.a, V) > 0;
  const [nearS, farS] = capNear ? [s1, s0] : [s0, s1];
  const near = ring.map((p) => at(W3(nearS, p)));
  const far = ring.map((p) => at(W3(farS, p)));
  const normals = ring.map(([x0, y0], i) => {
    const [x1, y1] = ring[(i + 1) % n];
    return G.unit3(G.add3(G.mul3(F.u, y1 - y0), G.mul3(F.v, -(x1 - x0))));
  });
  const facing = normals.map((m) => G.dot3(m, V) > 1e-9);
  const outline = [];
  const crease = [];
  for (const run of runsOfFlags(facing, false)) outline.push(k.pathOf(run.map((i) => near[i])));
  for (const run of runsOfFlags(facing, true)) {
    crease.push(k.pathOf(run.map((i) => near[i])));
    outline.push(k.pathOf(run.map((i) => far[i])));
  }
  for (let i = 0; i < n; i++) if (facing[(i + n - 1) % n] !== facing[i]) outline.push(k.pathOf([near[i], far[i]]));
  const parts = [k.pathOf(screenOriented(near), true), k.pathOf(screenOriented(far), true)];
  const buckets = [[], [], [], [], []];
  for (let i = 0; i < n; i++) {
    if (!facing[i]) continue;
    const quad = screenOriented([near[i], near[(i + 1) % n], far[(i + 1) % n], far[i]]);
    parts.push(k.pathOf(quad, true));
    buckets[G.toneOf(normals[i], P)].push(k.pathOf(quad, true));
  }
  const capTone = G.toneOf(capNear ? F.a : G.mul3(F.a, -1), P);
  buckets[capTone].push(k.pathOf(screenOriented(near), true));
  return { fill: parts.join(""), outline: outline.join(""), crease: crease.join(""), top: buckets[4].join(""), shades: buckets.slice(0, 4).map((b) => b.join("")) };
}
const XF = G.frameOf([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
function box(name, [x0, y0, z0], [x1, y1, z1], style = {}, { r = 0.4, steps = 2, bevel = 0, extra = "", inner = "", bias = 0, seg } = {}) {
  const plan = { x: x0, y: y0, w: x1 - x0, d: y1 - y0, r };
  const shape = record(A.slab(plan, z0, z1 - z0, { name }, steps));
  put(name, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], S(k.slabOf(plan, z0, z1 - z0, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { bias, seg });
  return shape;
}
function turned(name, F, profile, style = {}, { extra = "", inner = "", bias = 0, smooth, steps, rims, bevel = 0, owner, seg } = {}) {
  const opts = { bevel, ...(smooth !== undefined ? { smooth } : {}), ...(steps ? { steps } : {}), ...(rims ? { rims } : {}) };
  const paths = G.solidOf(profile, F, P, opts);
  const mid = (profile[0][0] + profile[profile.length - 1][0]) / 2;
  const shape = record(A.solid(F, profile, { name, owner }));
  put(name, G.add3(F.o, G.mul3(F.a, mid)), S(paths, { tone: "mid", ...style, inner }) + extra, [shape], { bias, seg });
  return shape;
}
const disc = (name, F, s0, s1, r, style = {}, options = {}) => turned(name, F, [[s0, r], [s1, r]], style, options);
const vcyl = (name, x, y, r, z0, z1, style = {}, options = {}) => disc(name, G.frameOf([x, y, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0]), z0, z1, r, style, options);
function planeMatrix(o, ex, ey) {
  const p0 = at(o);
  const px = at(G.add3(o, ex));
  const py = at(G.add3(o, ey));
  const v = (x) => x.toFixed(4);
  return `matrix(${v(px[0] - p0[0])} ${v(px[1] - p0[1])} ${v(py[0] - p0[0])} ${v(py[1] - p0[1])} ${p0[0].toFixed(2)} ${p0[1].toFixed(2)})`;
}
// 板面上的平面图形（走线、过孔、丝印、空焊盘）厚度为零，排序算法分不出它和板面谁在前，
// 所以直接拼进板子自己的图层、紧跟板面之后画，永远不会被板子盖住。
const OVER = {};
const overlay = (host, seg, svg) => { OVER[host] = (OVER[host] ?? "") + `<g class="lk-sub"${seg ? ` data-seg="${seg}"` : ""}>${svg}</g>`; };
// 板面走线：画在一个水平板面（z）或竖直板面（y）上
function traces(name, lines, { z, y, seg, pads = true, tone = "faint", bias = 0.05, kind = "trace", wide = false }) {
  const to3 = (p) => (z !== undefined ? [p[0], p[1], z + 0.02] : [p[0], y + 0.02, p[1]]);
  const d = lines.map((pts) => path3(pts.map(to3))).join("");
  const ends = pads ? lines.flatMap((pts) => [at(to3(pts[0])), at(to3(pts[pts.length - 1]))]) : [];
  const all = lines.flat().map(to3);
  const min = [0, 1, 2].map((i) => Math.min(...all.map((p) => p[i])));
  const max = [0, 1, 2].map((i) => Math.max(...all.map((p) => p[i])) + 0.05);
  const pad = z !== undefined ? [0.3, 0.3, 0] : [0.3, 0, 0.3];
  const cls = wide ? "lk-trace lk-wide" : "lk-trace";
  const hit = seg ? `<path class="lk-hitline" d="${d}"/>` : "";
  overlay(z === undefined ? "cam.board" : z === TB ? "ecu.board" : "disp.board", seg, hit + Ln(d, { tone, className: cls }) + (ends.length ? Dots(ends, { size: 0.32, tone: "lo" }) : ""));
  return lines.map((pts) => pts.map(to3));
}
const pins = (x0, x1, y0, y1, z, n) => {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    pts.push(at([x0 + (x1 - x0) * t, y0 - 0.3, z]), at([x0 + (x1 - x0) * t, y1 + 0.3, z]), at([x0 - 0.3, y0 + (y1 - y0) * t, z]), at([x1 + 0.3, y0 + (y1 - y0) * t, z]));
  }
  return pts;
};
// 水平板上的 QFN/BGA 芯片
function chip(name, cx, cy, w, d, zb, h, { seg, tone = "hi", dot = true, n = 6, bias = 0 } = {}) {
  const [x0, y0, x1, y1] = [cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2];
  const extra = Dots(pins(x0, x1, y0, y1, zb, n), { size: 0.24, tone: "lo" }) + (dot ? Dots([at([x0 + 1.2, y0 + 1.2, zb + h])], { size: 0.4, tone: "mid" }) : "") + Ln(k.planOutline(k.insetPlan({ x: x0, y: y0, w, d, r: 0.3 }, 0.9), zb + h, P, 2), { tone: "faint" });
  return box(name, [x0, y0, zb], [x1, y1, zb + h], { tone }, { r: 0.3, steps: 1, bevel: 0.3, extra, seg, bias });
}

// ---------- 电缆 ----------
const CABLES = [];
function cable(name, points, r, { tone = "mid", bend = 6, shells = [true, true], seg, maxLength = 14, bias = 0.05, rings } = {}) {
  const route = G.fillet(points, Math.max(bend, r * 2.6), 10, { P, tube: r });
  const total = G.pathLength(route);
  const SHELL = 6;
  const SR = r * 2.05;
  const gaps = [...(shells[0] ? [[0, SHELL]] : []), ...(shells[1] ? [[total - SHELL, total]] : [])];
  R.route(name, route, r, { gaps, limp: true, rims: shells.map((on) => (on ? SR : r)), piece: "bench" });
  CABLES.push({ name, route });
  tubePieces(route, r, P, { maxLength, spacing: 1.2, gaps, ...(rings ? { rings } : {}) }).forEach((piece, index) =>
    put(`${name}:${index}`, piece.mid, tubeSvg(piece, { tone }), [A.tube(piece.points, piece.radii)], { bias, route: name, chunk: index, seg }),
  );
  [0, 1].forEach((index) => {
    if (!shells[index]) return;
    const end = index ? route[route.length - 1] : route[0];
    const tangent = G.tangentAlong(route, index ? total : 0);
    const F = G.frameAlong(end, tangent);
    // 插座：卡口螺母 + 尾套，滚花
    const prof = index ? [[-SHELL, r * 1.25], [-2.6, SR], [0, SR]] : [[0, SR], [2.6, SR], [SHELL, r * 1.25]];
    const shape = record(A.solid(F, prof, { name: `${name}.plug${index}`, owner: name }));
    const ribs = G.ribsOf(F, index ? -2.6 : 0, index ? 0 : 2.6, SR, 22, P, { fade: [0.1, 0.55], seams: true });
    put(`${name}.plug${index}`, G.add3(end, G.mul3(tangent, index ? -SHELL / 2 : SHELL / 2)), S(G.solidOf(prof, F, P, {}), { tone: "mid" }) + k.fadedSvg(ribs, { tone: "lo" }), [shape], { bias: bias + 0.1, seg });
  });
  return route;
}

// ================= 台面 =================
const back = [];
back.push(`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
for (const [x, y] of byDepth([...k.corners(PLATE, 24), [0, PLATE.y + 24], [0, PLATE.y + PLATE.d - 24]])) {
  back.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
  back.push(S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
}
back.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid", inner: Ln(k.sideSeam(PLATE, -4, P, 8), { tone: "faint" }) }));
back.push(Ln(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
const plateScrews = k.corners(PLATE, 10);
back.push(Ln(plateScrews.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
back.push(Dots(plateScrews.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
// 台面上的 M6 螺孔阵列（光学平台那种）
{
  const holes = [];
  for (let x = PLATE.x + 30; x <= PLATE.x + PLATE.w - 30; x += 25) for (let y = PLATE.y + 30; y <= PLATE.y + PLATE.d - 40; y += 25) holes.push(at([x, y, 0]));
  back.push(Dots(holes, { size: 0.42, tone: "lo" }));
}
record(A.slab(PLATE, -PLATE_H, PLATE_H, { name: "stand.plate", ground: true }, 8));
const STRIP = { x: PLATE.x + 16, y: PLATE.y + PLATE.d - 13, w: 128, d: 6, r: 1 };
back.push(S(k.slabOf(STRIP, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
{
  const t = k.topTicks(STRIP.x + 4, STRIP.x + STRIP.w - 4, 4, 5, STRIP.y, 0.6, [1.8, 3.4], P);
  back.push(Ln(t.minor, { tone: "lo" }), Ln(t.major, { tone: "mid" }));
}
const LABEL = { x: -226, y: 42, w: 46, d: 16, r: 1.2 };
back.push(S(k.slabOf(LABEL, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
back.push(Ln(k.planOutline(k.insetPlan(LABEL, 1.4), 0.8, P, 3), { tone: "faint" }));
back.push(k.faceTextSvg(k.topMatrix([LABEL.x + 4, LABEL.y + 7], 0.8, P, "x"), "GMSL3 BENCH", { size: 3.2, tone: "mid" }));
back.push(Ln([30, 22].map((w, i) => k.lineOnTop([LABEL.x + 4, LABEL.y + 10.4 + i * 2.6], [LABEL.x + 4 + w, LABEL.y + 10.4 + i * 2.6], 0.8, P)).join(""), { tone: "lo", free: true }));
back.push(Dots([at([LABEL.x + LABEL.w - 2.6, LABEL.y + 2.4, 0.8]), at([LABEL.x + LABEL.w - 2.6, LABEL.y + LABEL.d - 2.4, 0.8])], { size: 0.45 }));

// ================= 测试卡 =================
const CHART = { x0: -229, x1: -169, z0: 22, z1: 60, y: -88 };
box("chart.foot", [-236, -96, 0], [-162, -82, 3], { tone: "lo" }, { r: 2, steps: 3, bevel: 0.4, extra: Dots([at([-232, -86, 3]), at([-166, -86, 3])], { size: 0.45 }) });
box("chart.post", [-232, -91, 3], [-229, -87, 64], { tone: "mid" }, { r: 0.6 });
box("chart.post", [-169, -91, 3], [-166, -87, 64], { tone: "mid" }, { r: 0.6 });
box("chart.board", [CHART.x0, -90, CHART.z0], [CHART.x1, CHART.y, CHART.z1], { tone: "mid" }, { r: 0.2, steps: 1 });
for (const z of [27, 53]) box("chart.clip", [-233, -87, z], [-226, -86.2, z + 3], { tone: "lo" }, { r: 0.4 });
for (const z of [27, 53]) box("chart.clip", [-172, -87, z], [-165, -86.2, z + 3], { tone: "lo" }, { r: 0.4 });
// 测试卡图案：中心西门子星 + 四个斜边方块（SFR）+ 边框，画在 y = -88 的平面里
const CHART_W = CHART.x1 - CHART.x0;
const CHART_H = CHART.z1 - CHART.z0;
function chartArt(w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const star = Array.from({ length: 12 }, (_, i) => {
    const a0 = (i / 12) * Math.PI * 2;
    const a1 = a0 + Math.PI / 12;
    const r = Math.min(w, h) * 0.2;
    return `M${f2(cx)} ${f2(cy)}L${f2(cx + r * Math.cos(a0))} ${f2(cy + r * Math.sin(a0))}A${f2(r)} ${f2(r)} 0 0 1 ${f2(cx + r * Math.cos(a1))} ${f2(cy + r * Math.sin(a1))}Z`;
  }).join("");
  const sq = (qx, qy) => {
    const s = Math.min(w, h) * 0.16;
    const a = (5 * Math.PI) / 180;
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [qx + (u * Math.cos(a) - v * Math.sin(a)) * s / 2, qy + (u * Math.sin(a) + v * Math.cos(a)) * s / 2]);
    return `M${pts.map(([x, y]) => `${f2(x)} ${f2(y)}`).join("L")}Z`;
  };
  const squares = [[0.17, 0.2], [0.83, 0.2], [0.17, 0.8], [0.83, 0.8]].map(([u, v]) => sq(u * w, v * h)).join("");
  const ticks = Array.from({ length: 9 }, (_, i) => `M${f2(w * 0.3 + i * w * 0.05)} ${f2(h * 0.94)}V${f2(h * (i % 2 ? 0.97 : 0.99))}`).join("");
  return `<rect class="lk-chart-bg" x="0" y="0" width="${f2(w)}" height="${f2(h)}"/><path class="lk-ink" d="${star}${squares}"/><circle class="lk-ring" cx="${f2(cx)}" cy="${f2(cy)}" r="${f2(Math.min(w, h) * 0.2)}"/><rect class="lk-ring" x="${f2(w * 0.03)}" y="${f2(h * 0.03)}" width="${f2(w * 0.94)}" height="${f2(h * 0.94)}"/><path class="lk-ring" d="${ticks}"/>`;
}
put("chart.art", [-199, CHART.y + 0.05, (CHART.z0 + CHART.z1) / 2], `<g transform="${planeMatrix([CHART.x0 + 1.5, CHART.y + 0.02, CHART.z1 - 1.5], [1, 0, 0], [0, 0, -1])}">${chartArt(CHART_W - 3, CHART_H - 3)}</g>`, [record(A.box([CHART.x0, CHART.y, CHART.z0], [CHART.x1, CHART.y + 0.05, CHART.z1], { name: "chart.art" }))], { bias: 0.4 });

// ================= 1 摄像头 =================
const CAM = { x0: -200, x1: -170, y0: -64, y1: -40, z0: 15, z1: 43 };
const CAMX = -185;
vcyl("cam.mount.puck", CAMX, -52, 9, 0, 2.4, { tone: "lo" }, { inner: "" });
vcyl("cam.mount.post", CAMX, -52, 2.4, 2.4, 11, { tone: "mid" });
vcyl("cam.mount.knob", CAMX + 2.4 + 2.6, -52, 2.6, 5, 8, { tone: "mid" });
box("cam.mount.head", [CAMX - 8, -60, 11], [CAMX + 8, -44, CAM.z0], { tone: "mid" }, { r: 1.2, steps: 3, bevel: 0.3 });
box("cam.housing", [CAM.x0, CAM.y0, CAM.z0], [CAM.x1, CAM.y1, CAM.z1], { tone: "mid" }, {
  r: 3, steps: 4, bevel: 0.6, seg: "cam",
  extra: Ln(path3([[CAM.x0, -52, CAM.z1], [CAM.x1, -52, CAM.z1], [CAM.x1, -52, CAM.z0]]), { tone: "faint" }) + Dots([at([CAM.x0 + 4, -60, CAM.z1]), at([CAM.x1 - 4, -60, CAM.z1]), at([CAM.x0 + 4, -44, CAM.z1]), at([CAM.x1 - 4, -44, CAM.z1])], { size: 0.45 }),
});
{
  const LF = G.frameOf([CAMX, CAM.y0, 29], [0, -1, 0], [1, 0, 0], [0, 0, 1]);
  turned("cam.lens", LF, [[0, 11.6], [2.4, 11.6], [2.4, 10.2], [9, 10.2], [9, 8.8], [12, 8.8], [12, 9.6], [17, 11.4], [17, 10.4]], { tone: "mid" }, {
    seg: "cam",
    extra: k.fadedSvg(G.ribsOf(LF, 2.4, 9, 10.2, 44, P, { fade: [0.1, 0.55], seams: true }), { tone: "lo" }),
  });
}
// 后盖拆下平放在台面上
box("cam.cover", [-238, -26, 0], [-208, -2, 1.6], { tone: "mid" }, {
  r: 3, steps: 4, bevel: 0.4,
  extra: Ln(k.planOutline({ x: -235, y: -23, w: 24, d: 18, r: 1.6 }, 1.6, P, 3), { tone: "faint" }) + Dots([[-234.5, -22.5], [-211.5, -22.5], [-234.5, -5.5], [-211.5, -5.5]].map(([x, y]) => at([x, y, 1.6])), { size: 0.45 }),
});
for (const [x, y] of [[-203, 6], [-199, 9], [-196, 5]]) vcyl("cam.screw", x, y, 0.9, 0, 0.8, { tone: "hi" });

// 串行器板（竖直，板面朝 +y）
const CB = { x0: -198, x1: -172, z0: 17, z1: 41, y0: -40, y1: -38.6 };
const FY = CB.y1;
box("cam.board", [CB.x0, CB.y0, CB.z0], [CB.x1, CB.y1, CB.z1], { tone: "lo" }, {
  r: 0.4, extra: Dots([[CB.x0 + 1.6, CB.z0 + 1.6], [CB.x1 - 1.6, CB.z0 + 1.6], [CB.x0 + 1.6, CB.z1 - 1.6], [CB.x1 - 1.6, CB.z1 - 1.6]].map(([x, z]) => at([x, FY, z])), { size: 0.55, tone: "hi" }),
});
const vbox = (name, x0, z0, x1, z1, h, style, options = {}) => box(name, [x0, FY, z0], [x1, FY + h, z1], style, { r: 0.2, steps: 1, ...options });
const SER1 = { x0: -194, x1: -185.5, z0: 30, z1: 38.5 };
vbox("ser1", SER1.x0, SER1.z0, SER1.x1, SER1.z1, 1.2, { tone: "hi" }, {
  seg: "ser1", bevel: 0.3,
  extra: Dots(Array.from({ length: 6 }, (_, i) => { const t = (i + 0.5) / 6; return [at([SER1.x0 + (SER1.x1 - SER1.x0) * t, FY, SER1.z0 - 0.3]), at([SER1.x0 + (SER1.x1 - SER1.x0) * t, FY, SER1.z1 + 0.3]), at([SER1.x0 - 0.3, FY, SER1.z0 + (SER1.z1 - SER1.z0) * t]), at([SER1.x1 + 0.3, FY, SER1.z0 + (SER1.z1 - SER1.z0) * t])]; }).flat(), { size: 0.24, tone: "lo" }) + Dots([at([SER1.x0 + 1.2, FY + 1.2, SER1.z1 - 1.2])], { size: 0.4 }),
});
vbox("cam.b2b", -183, 36.2, -175, 39.4, 1.8, { tone: "mid" }, { extra: Dots(Array.from({ length: 6 }, (_, i) => at([-182.3 + i * 1.3, FY + 1.8, 37.8])), { size: 0.25, tone: "lo" }) });
vbox("cam.pmic", -196, 19.5, -190.5, 24.5, 1, { tone: "hi" });
const CAMJ = { x: -180, z: 24 };
vbox("a1.cap", -180.8, 29.2, -179.2, 30.2, 0.8, { tone: "hi" }, { seg: "a1" });
vbox("a1.esd", -177.8, 27.8, -176.4, 28.8, 0.8, { tone: "hi" }, { seg: "a1" });
disc("a1.poc", G.frameAlong([-175.6, FY, 34.4], [0, 1, 0]), 0, 2.4, 2.1, { tone: "hi" }, { seg: "a1", inner: Ln(G.arcOf(G.frameAlong([-175.6, FY, 34.4], [0, 1, 0]), 1.2, 2.1, P), { tone: "faint" }) });
traces("cam.mipi", [[[-183, 37], [-185.5, 37]], [[-183, 36.6], [-183.6, 36.6], [-183.6, 35.4], [-185.5, 35.4]]], { y: FY });
traces("cam.pwr", [[[-190.5, 22], [-178, 22], [-178, 19]], [[-175.6, 32.3], [-175.6, 22.6], [-178, 22.6]]], { y: FY });
const A1_TRACE = traces("a1.trace", [[[-185.5, 32], [-180, 32], [-180, 27.6]], [[-180, 30.8], [-177.1, 30.8], [-177.1, 28.8]], [[-180, 32], [-177.6, 32], [-177.6, 34.4]]], { y: FY, seg: "a1", tone: "mid", wide: true });
box("a1.jack", [CAMJ.x - 3.6, FY, CAMJ.z - 3.6], [CAMJ.x + 3.6, -33, CAMJ.z + 3.6], { tone: "mid" }, { r: 0.6, steps: 2, bevel: 0.3, seg: "a1" });
box("a1.jack.key", [CAMJ.x - 1, -37.4, CAMJ.z + 3.6], [CAMJ.x + 1, -33, CAMJ.z + 4.6], { tone: "mid" }, { r: 0.2, seg: "a1" });
disc("a1.jack.barrel", G.frameAlong([CAMJ.x, -33, CAMJ.z], [0, 1, 0]), 0, 4, 3.3, { tone: "hi" }, { seg: "a1" });

// ================= ECU =================
const EB = { x0: -62, x1: 62, y0: -58, y1: 46 };
const TB = 9.6;
box("ecu.base", [EB.x0, EB.y0, 0], [EB.x1, EB.y1, 5], { tone: "mid" }, {
  r: 3, steps: 4, bevel: 0.6,
  inner: Ln(k.sideSeam({ x: EB.x0, y: EB.y0, w: EB.x1 - EB.x0, d: EB.y1 - EB.y0, r: 3 }, 2.5, P, 4), { tone: "faint" }),
  extra: Dots(k.corners({ x: EB.x0, y: EB.y0, w: EB.x1 - EB.x0, d: EB.y1 - EB.y0 }, 2.4).map(([x, y]) => at([x, y, 5])), { size: 0.5 }),
});
for (const [x, y] of [[-54, -50], [54, -50], [-54, 38], [54, 38]]) {
  vcyl("ecu.standoff", x, y, 2.2, 5, 8, { tone: "lo" });
}
box("ecu.board", [-58, -54, 8], [58, 42, TB], { tone: "lo" }, { r: 2, steps: 3 });
for (const [x, y] of [[-54, -50], [54, -50], [-54, 38], [54, 38]]) vcyl("ecu.screw", x, y, 1.6, TB, TB + 0.8, { tone: "mid" }, { extra: Ln(k.lineOnTop([x - 1, y], [x + 1, y], TB + 0.8, P), { tone: "lo" }) });
// 连接器（直角板载，同轴口朝 +y）
const JZ = TB + 4.6;
function rightAngle(prefix, cx, seg) {
  box(`${prefix}.jack`, [cx - 5, 32, TB], [cx + 5, 44, TB + 9.2], { tone: "mid" }, {
    r: 0.8, steps: 2, bevel: 0.4, seg,
    extra: Dots([at([cx - 3.6, 44, TB + 1.4]), at([cx + 3.6, 44, TB + 1.4])], { size: 0.4 }),
  });
  box(`${prefix}.jack.key`, [cx - 1.2, 38, TB + 9.2], [cx + 1.2, 44, TB + 10.2], { tone: "mid" }, { r: 0.2, seg });
  disc(`${prefix}.jack.barrel`, G.frameAlong([cx, 44, JZ], [0, 1, 0]), 0, 4, 3.3, { tone: "hi" }, { seg });
}
rightAngle("a2", -30, "a2");
rightAngle("b1", 30, "b1");
chip("des1", -30, 12.5, 9, 9, TB, 1.2, { seg: "des1" });
chip("ser2", 30, 12.5, 9, 9, TB, 1.2, { seg: "ser2" });
// 控制器：封装 + 散热片
box("soc.pkg", [-13, -37, TB], [13, -11, TB + 1.4], { tone: "mid" }, { r: 0.6, steps: 2, seg: "soc", extra: Dots(pins(-13, 13, -37, -11, TB, 9), { size: 0.24, tone: "lo" }) });
box("soc.die", [-10, -34, TB + 1.4], [10, -14, TB + 2.4], { tone: "hi" }, { r: 0.4, steps: 2, seg: "soc" });
for (let i = 0; i < 8; i++) box("soc.fin", [-9.6 + i * 2.6, -33.4, TB + 2.4], [-8.4 + i * 2.6, -14.6, TB + 10], { tone: "hi" }, { r: 0.2, steps: 1, seg: "soc" });
chip("ddr.l", -36, -29, 12, 9, TB, 1.1, { n: 7 });
chip("ddr.r", 36, -29, 12, 9, TB, 1.1, { n: 7 });
chip("pmic", -48, -16, 7, 7, TB, 1);
vcyl("pmic.ind", -48, -6, 2.4, TB, TB + 3, { tone: "mid" });
vcyl("pmic.ind", -48, -44, 2.4, TB, TB + 3, { tone: "mid" });
for (const [x, y] of [[50, -16], [50, -42]]) vcyl("ecu.ecap", x, y, 2.8, TB, TB + 6.4, { tone: "hi" }, { inner: Ln(k.sideArc(x, y, 2.8, TB + 5.6, P, 20), { tone: "faint" }), extra: Ln(k.lineOnTop([x - 1.6, y], [x + 1.6, y], TB + 6.4, P) + k.lineOnTop([x, y - 1.6], [x, y + 1.6], TB + 6.4, P), { tone: "lo" }) });
box("ecu.xtal", [-19, -2, TB], [-14, 1, TB + 1.2], { tone: "hi" }, { r: 0.8, steps: 3 });
box("ecu.pwr", [38, 30, TB], [50, 40, TB + 6], { tone: "mid" }, { r: 0.5, extra: Dots([41, 44, 47].map((x) => at([x, 40, TB + 3])), { size: 0.5, tone: "hi" }) });
// PoC 网络（ECU 侧把直流注入通道 A）
vcyl("a2.poc", -42, 25, 2.2, TB, TB + 3.2, { tone: "hi" }, { seg: "a2", extra: Ln(k.ring(-42, 25, 1, TB + 3.2, P, 16), { tone: "lo" }) });
box("a2.poc.cap", [-46.8, 23.6, TB], [-45.2, 26.4, TB + 0.9], { tone: "hi" }, { seg: "a2" });
box("a2.cap", [-30.8, 22.6, TB], [-29.2, 24.2, TB + 0.8], { tone: "hi" }, { seg: "a2" });
box("a2.esd", [-27.2, 27.2, TB], [-25.6, 28.8, TB + 0.8], { tone: "hi" }, { seg: "a2" });
box("b1.cap", [29.2, 22.6, TB], [30.8, 24.2, TB + 0.8], { tone: "hi" }, { seg: "b1" });
box("b1.esd", [32.8, 27.2, TB], [34.4, 28.8, TB + 0.8], { tone: "hi" }, { seg: "b1" });
const A2_TRACE = traces("a2.trace", [[[-30, 32], [-30, 17]], [[-30, 25], [-39.8, 25]], [[-30, 28], [-26.4, 28]]], { z: TB, seg: "a2", tone: "mid", wide: true });
traces("ecu.pocfeed", [[[-44.2, 25], [-48, 25], [-48, -12.5]]], { z: TB });
// D-PHY / eDP 都画成 5 对差分线：对内间距 0.6，对间 1.6（CSI-2、DSI = 1 时钟 + 4 数据；eDP = 4 主链路 + 1 AUX）
const PAIRS = Array.from({ length: 10 }, (_, i) => Math.floor(i / 2) * 1.6 + (i % 2) * 0.6);
const SPAN = PAIRS[PAIRS.length - 1];
traces("soc.in", PAIRS.map((o) => { const x0 = -34 + o; const yk = -14 - (SPAN - o); return [[x0, 8], [x0, yk], [-13, yk]]; }), { z: TB, seg: "soc", tone: "mid", pads: false });
traces("soc.out", PAIRS.map((o) => { const x0 = 34 - o; const yk = -14 - (SPAN - o); return [[13, yk], [x0, yk], [x0, 8]]; }), { z: TB, seg: "soc", tone: "mid", pads: false });
traces("ecu.ddr", [-1, 1].flatMap((s) => [0, 1, 2, 3, 4].map((i) => [[s * 30, -26.4 - i * 1.4], [s * 13, -26.4 - i * 1.4]])), { z: TB, pads: false });
traces("ecu.misc", [[[-14, -0.5], [-13, -0.5], [-13, -11]], [[38, 33], [36, 33], [36, 38]]], { z: TB });
// 细节：去耦电容、调试排针、状态灯、过孔缝合、丝印框
function passives(prefix, list, zb, seg) {
  for (const [x, y, rot] of list) {
    const [w, d] = rot ? [0.7, 1.4] : [1.4, 0.7];
    box(prefix, [x - w / 2, y - d / 2, zb], [x + w / 2, y + d / 2, zb + 0.55], { tone: "hi" }, { r: 0.1, steps: 1, seg });
  }
}
passives("soc.decap", Array.from({ length: 8 }, (_, i) => [-8.75 + i * 2.5, -8.6, false]), TB, "soc");
passives("des1.decap", [[-36.6, 10, true], [-36.6, 13, true], [-36.6, 16, true]], TB, "des1");
passives("ser2.decap", [[36.6, 10, true], [36.6, 13, true], [36.6, 16, true]], TB, "ser2");
passives("ecu.r", [[-20, 30, false], [-20, 33, false], [20, 30, false], [20, 33, false], [-52, 2, true], [-50, 2, true]], TB);
box("ecu.header", [-56, 14, TB], [-49.6, 26, TB + 2.4], { tone: "mid" }, { r: 0.3, steps: 1, extra: Dots([0, 1, 2, 3, 4].flatMap((i) => [at([-54.4, 15.2 + i * 2.4, TB + 2.4]), at([-51.2, 15.2 + i * 2.4, TB + 2.4])]), { size: 0.45, tone: "hi" }) });
put("ecu.led", [52, 22, TB + 0.6], `<g class="lk-led" data-led="ecu">${S(k.slabOf({ x: 51, y: 21.2, w: 2, d: 1.6, r: 0.3 }, TB, 0.7, P, 2), { tone: "hi" })}</g>`, [record(A.box([51, 21.2, TB], [53, 22.8, TB + 0.7], { name: "ecu.led" }))]);
overlay("ecu.board", null, Dots(Array.from({ length: 24 }, (_, i) => at([-46 + i * 4, 40, TB])).concat(Array.from({ length: 22 }, (_, i) => at([-56, -46 + i * 4, TB]))), { size: 0.3, tone: "lo" }) + Ln(k.planOutline({ x: -56.4, y: -52.4, w: 112.8, d: 92.8, r: 1.4 }, TB + 0.01, P, 3), { tone: "faint" }));
const B1_TRACE = traces("b1.trace", [[[30, 17], [30, 32]], [[30, 28], [32.8, 28]]], { z: TB, seg: "b1", tone: "mid", wide: true });

// ================= 屏幕 =================
const PANEL = { x0: 143, x1: 227, y0: -46, y1: -40, z0: 24, z1: 80 };
box("disp.foot", [163, -60, 0], [207, -30, 3], { tone: "lo" }, { r: 5, steps: 4, bevel: 0.5, extra: Dots([at([167, -34, 3]), at([203, -34, 3])], { size: 0.45 }) });
box("disp.neck", [179, -52, 3], [191, PANEL.y0, 62], { tone: "mid" }, { r: 1, steps: 2, bevel: 0.3 });
box("disp.panel", [PANEL.x0, PANEL.y0, PANEL.z0], [PANEL.x1, PANEL.y1, PANEL.z1], { tone: "mid" }, {
  r: 1.6, steps: 3, bevel: 0.5, seg: "disp",
  extra: Ln(path3([[PANEL.x0, -43, PANEL.z1], [PANEL.x1, -43, PANEL.z1], [PANEL.x1, -43, PANEL.z0]]), { tone: "faint" }),
});
const SCR = { x0: 147, x1: 223, z0: 30, z1: 76 };
put("disp.screen", [185, PANEL.y1 + 0.05, 53], (() => {
  const m = planeMatrix([SCR.x0, PANEL.y1 + 0.02, SCR.z1], [1, 0, 0], [0, 0, -1]);
  const w = SCR.x1 - SCR.x0;
  const h = SCR.z1 - SCR.z0;
  const fit = Math.min((w - 2) / (CHART_W - 3), (h - 2) / (CHART_H - 3));
  const aw = (CHART_W - 3) * fit;
  const ah = (CHART_H - 3) * fit;
  return `<g transform="${m}"><rect class="lk-screen" x="0" y="0" width="${w}" height="${h}" rx="0.6"/><g class="lk-picture" data-part="picture" transform="translate(${f2((w - aw) / 2)} ${f2((h - ah) / 2)}) scale(${f2(aw / (CHART_W - 3))} ${f2(ah / (CHART_H - 3))})">${chartArt(CHART_W - 3, CHART_H - 3)}</g><rect class="lk-screen-edge" x="0" y="0" width="${w}" height="${h}" rx="0.6"/></g>`;
})(), [record(A.box([SCR.x0, PANEL.y1, SCR.z0], [SCR.x1, PANEL.y1 + 0.05, SCR.z1], { name: "disp.screen" }))], { bias: 0.1, seg: "disp" });

const DB = { x0: 146, x1: 224, y0: -12, y1: 42 };
const TD = 8.4;
box("disp.tray", [DB.x0, DB.y0, 0], [DB.x1, DB.y1, 4], { tone: "mid" }, {
  r: 3, steps: 4, bevel: 0.5,
  inner: Ln(k.sideSeam({ x: DB.x0, y: DB.y0, w: DB.x1 - DB.x0, d: DB.y1 - DB.y0, r: 3 }, 2, P, 4), { tone: "faint" }),
});
for (const [x, y] of [[151, -7], [219, -7], [151, 37], [219, 37]]) vcyl("disp.standoff", x, y, 2, 4, 6.8, { tone: "lo" });
box("disp.board", [148, -10, 6.8], [222, 40, TD], { tone: "lo" }, { r: 1.6, steps: 3 });
for (const [x, y] of [[151, -7], [219, -7], [151, 37], [219, 37]]) vcyl("disp.screw", x, y, 1.4, TD, TD + 0.7, { tone: "mid" });
function rightAngleD(prefix, cx, seg) {
  box(`${prefix}.jack`, [cx - 5, 30, TD], [cx + 5, 42, TD + 9.2], { tone: "mid" }, { r: 0.8, steps: 2, bevel: 0.4, seg, extra: Dots([at([cx - 3.6, 42, TD + 1.4]), at([cx + 3.6, 42, TD + 1.4])], { size: 0.4 }) });
  box(`${prefix}.jack.key`, [cx - 1.2, 36, TD + 9.2], [cx + 1.2, 42, TD + 10.2], { tone: "mid" }, { r: 0.2, seg });
  disc(`${prefix}.jack.barrel`, G.frameAlong([cx, 42, TD + 4.6], [0, 1, 0]), 0, 4, 3.3, { tone: "hi" }, { seg });
}
const DJX = 170;
rightAngleD("b2", DJX, "b2");
chip("des2", DJX, 14.5, 9, 9, TD, 1.2, { seg: "des2" });
box("b2.cap", [DJX - 0.8, 22.6, TD], [DJX + 0.8, 24.2, TD + 0.8], { tone: "hi" }, { seg: "b2" });
box("b2.esd", [DJX + 2.8, 25.2, TD], [DJX + 4.4, 26.8, TD + 0.8], { tone: "hi" }, { seg: "b2" });
overlay("disp.board", "b2", Ln(k.planOutline({ x: DJX - 8, y: 24.6, w: 4, d: 2.8, r: 0.3 }, TD, P, 1) + k.planOutline({ x: DJX - 8.6, y: 24, w: 5.2, d: 4, r: 0.4 }, TD, P, 1), { tone: "lo" }));
const B2_TRACE = traces("b2.trace", [[[DJX, 30], [DJX, 19]], [[DJX, 26], [DJX + 2.8, 26]], [[DJX, 26], [DJX - 3.4, 26]]], { z: TD, seg: "b2", tone: "mid", wide: true });
chip("tcon", 206, 15, 11, 9, TD, 1.2, { n: 7 });
box("disp.dcjack", [203, 28, TD], [213, 38, TD + 6], { tone: "mid" }, { r: 0.8, steps: 2, extra: Ln(k.ring(208, 38, 1.6, TD + 3, P, 16), { tone: "faint" }) });
vcyl("disp.ecap", 158, 6, 2.6, TD, TD + 5.6, { tone: "hi" }, { inner: Ln(k.sideArc(158, 6, 2.6, TD + 4.8, P, 20), { tone: "faint" }) });
box("disp.fpcconn", [188, -9, TD], [202, -3, TD + 2], { tone: "mid" }, { r: 0.3, seg: "disp", extra: Ln(path3([[188.6, -9, TD + 2], [201.4, -9, TD + 2]]), { tone: "lo" }) });
traces("des2.out", PAIRS.map((o) => { const x0 = DJX - SPAN / 2 + o; const yk = 6.5 - (SPAN - o) * 0.95; const xe = 190.2 + o * 1.3; return [[x0, 10], [x0, yk], [xe, yk], [xe, -3]]; }), { z: TD, seg: "des2", tone: "mid", pads: false });
traces("disp.misc", [[[203, 33], [201, 33], [201, 19.5]]], { z: TD });
passives("des2.decap", [[DJX - 6.6, 11, true], [DJX - 6.6, 14, true], [DJX - 6.6, 17, true]], TD, "des2");
passives("disp.r", [[186, 14, false], [186, 17, false], [186, 20, false], [213, 9, true], [215, 9, true]], TD);
put("disp.led", [216, 2, TD + 0.6], `<g class="lk-led" data-led="disp">${S(k.slabOf({ x: 215, y: 1.2, w: 2, d: 1.6, r: 0.3 }, TD, 0.7, P, 2), { tone: "hi" })}</g>`, [record(A.box([215, 1.2, TD], [217, 2.8, TD + 0.7], { name: "disp.led" }))]);
overlay("disp.board", null, Dots(Array.from({ length: 17 }, (_, i) => at([152 + i * 4, 38, TD])), { size: 0.3, tone: "lo" }) + Ln(k.planOutline({ x: 149.6, y: -8.4, w: 70.8, d: 46.8, r: 1 }, TD + 0.01, P, 3), { tone: "faint" }));
// 排线（FFC）从连接器到面板底边
{
  const C = [[-9, TD + 1], [-16, TD + 1], [-24, TD + 2.8], [-32, TD + 7.6], [-38, TD + 12.4], [-42.6, TD + 15], [-43, PANEL.z0]];
  const half = 0.25;
  for (let i = 0; i < C.length - 1; i++) {
    const [a, b] = [C[i], C[i + 1]];
    const d = [b[0] - a[0], b[1] - a[1]];
    const L = Math.hypot(...d);
    const n = [-d[1] / L, d[0] / L];
    const quad = [[a[0] + n[0] * half, a[1] + n[1] * half], [b[0] + n[0] * half, b[1] + n[1] * half], [b[0] - n[0] * half, b[1] - n[1] * half], [a[0] - n[0] * half, a[1] - n[1] * half]];
    const shape = record(A.prism(XF, quad, 190, 200, { name: "disp.ffc" }));
    const lines = Ln([192.5, 195, 197.5].map((x) => path3([[x, a[0], a[1] + half + 0.02], [x, b[0], b[1] + half + 0.02]])).join(""), { tone: "faint" });
    put("disp.ffc", [195, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2], S(prismPaths(XF, quad, 190, 200), { tone: "mid" }) + lines, [shape], { seg: "disp" });
  }
}

// ================= 线缆 =================
const CR = 1.5;
const LIE = CR + 0.8;
const INLINE = { x0: -130, x1: -110, y: 24, z: 3.6 };
{
  const F = G.frameOf([INLINE.x0, INLINE.y, INLINE.z], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  turned("ca.inline", F, [[0, 3.1], [8.6, 3.1], [8.6, 3.6], [11.4, 3.6], [11.4, 3.1], [20, 3.1]], { tone: "mid" }, {
    seg: "ca",
    extra: k.fadedSvg(G.ribsOf(F, 8.6, 11.4, 3.6, 26, P, { fade: [0.1, 0.55], seams: true }), { tone: "lo" }),
  });
}
const CA1 = cable("ca.1", [[CAMJ.x, -29, CAMJ.z], [CAMJ.x, -16, CAMJ.z], [CAMJ.x + 2, -2, LIE], [-168, 24, LIE], [-146, INLINE.y, INLINE.z], [INLINE.x0, INLINE.y, INLINE.z]], CR, { seg: "ca", shells: [true, false], bend: 7 });
const CA2 = cable("ca.2", [[INLINE.x1, INLINE.y, INLINE.z], [-96, INLINE.y, INLINE.z], [-78, 62, LIE], [-40, 70, LIE], [-30, 64, JZ], [-30, 48, JZ]], CR, { seg: "ca", shells: [false, true], bend: 7 });
const CB_ = cable("cb", [[30, 48, JZ], [30, 62, JZ], [44, 74, LIE], [120, 74, LIE], [158, 62, LIE], [DJX, 56, TD + 4.6], [DJX, 46, TD + 4.6]], CR, { seg: "cb", shells: [true, true], bend: 7 });

for (const [host, svg] of Object.entries(OVER)) {
  const item = R.items.find((it) => it.name === host);
  if (!item) throw new Error(`overlay host ${host} not found`);
  item.svg += svg;
}
A.settle(R, P);
R.items.sort((a, b) => a.key - b.key);
const groups = R.items.map((item) => `<g class="it" data-name="${item.name}"${item.attrs ?? ""}>${item.svg}</g>`);

// ================= 动画路径（屏幕坐标） =================
const scr = (pts) => pts.map((p) => at(p).map(f2));
const lens = [CAMX, CAM.y0 - 11, 29];
const PATHS = {
  cam: scr([lens, [CAMX, -52, 29], [-189.75, FY + 1.2, 34.25]]),
  ser1: scr([[-189.75, FY + 1.2, 34.25], [-185.5, FY + 0.6, 32]]),
  a1: scr([[-185.5, FY, 32], [-180, FY, 32], [-180, FY, 27.6], [CAMJ.x, -29, CAMJ.z]]),
  ca: scr([...CA1, ...CA2]),
  a2: scr([[-30, 48, JZ], [-30, 32, JZ], [-30, 32, TB], [-30, 17, TB]]),
  des1: scr([[-30, 17, TB + 1.2], [-30, 8, TB + 1.2]]),
  soc: scr([[-30.2, 8, TB], [-30.2, -18.2, TB], [-13, -18.2, TB], [0, -24, TB + 10], [13, -18.2, TB], [30.2, -18.2, TB], [30.2, 8, TB]]),
  ser2: scr([[30, 8, TB + 1.2], [30, 17, TB + 1.2]]),
  b1: scr([[30, 17, TB], [30, 32, TB], [30, 32, JZ], [30, 48, JZ]]),
  cb: scr(CB_),
  b2: scr([[DJX, 46, TD + 4.6], [DJX, 30, TD + 4.6], [DJX, 30, TD], [DJX, 19, TD]]),
  des2: scr([[DJX, 19, TD + 1.2], [DJX, 10, TD + 1.2]]),
  disp: scr([[DJX + 0.8, 10, TD], [DJX + 0.8, 3.6, TD], [195, 3.6, TD], [195, -3, TD], [195, -9, TD + 1.25], [195, -16, TD + 1.25], [195, -24, TD + 3.05], [195, -32, TD + 7.85], [195, -38, TD + 12.65], [195, -42.4, TD + 15.25], [195, -43, PANEL.z0], [185, PANEL.y1, 53]]),
};


const LABEL_TEXT = "一张试验台：左边摄像头对着测试卡，后盖拆下，露出串行器板；同轴线经一节在线连接器接到中间去掉外壳的 ECU 板上，板上依次是解串器、控制器（带散热片）和第二个串行器；第二根同轴线接到右边屏幕的驱动板，排线把画面送进面板，屏幕上显示的正是那张测试卡。";
const svg = k.figureSvg({
  width: W,
  height: H,
  label: LABEL_TEXT,
  body: [...back, `<g class="lk-bench">${groups.join("")}</g>`, `<g data-part="poc"></g>`, `<g data-part="packets"></g>`],
});

const DATA = { paths: PATHS, segs: SEGMENTS, link: LINK, rev: { short: ilPinToPin(LINK.revKey, false), long: ilPinToPin(LINK.revKey, true) } };
const CSS = readFileSync(join(HERE, "link.css"), "utf8");
const REWARD = readFileSync(join(HERE, "assets/reward-wechat.png")).toString("base64");
const LIVE = readFileSync(join(HERE, "live.js"), "utf8").replace("__DATA__", JSON.stringify(DATA));
const MODEL = readFileSync(join(HERE, "model.mjs"), "utf8").replace(/^export /gm, "");

const chain = SEGMENTS.map((s) => `<button type="button" class="lk-chip" data-kind="${s.kind}" data-pick="${s.id}"><span class="lk-num">${s.num}</span>${s.name}</button>`).join("");
const panel = `
<section class="lk-panel" aria-label="链路说明">
  <div class="lk-controls">
    <span class="lk-group" role="group" aria-label="通道长度"><button type="button" data-mode="short" aria-pressed="true">短通道</button><button type="button" data-mode="long" aria-pressed="false">长通道</button></span>
    <span class="lk-group"><button type="button" data-toggle="rev" aria-pressed="true">反向通道</button><button type="button" data-toggle="poc" aria-pressed="true">PoC 供电</button><button type="button" data-toggle="run" aria-pressed="true">动画</button></span>
  </div>
  <div class="lk-chain" role="list">${chain}</div>
  <div class="lk-detail" data-detail aria-live="polite"></div>
  <div class="lk-budget" data-budget></div>
</section>`;

const body =
  `<style>${CSS}</style>` +
  k.plateHtml({
    fig: "Fig 1",
    title: "GMSL3 两跳视频链路",
    hint: "悬停预览 · 点击固定 · ← → 逐个看 · L 长短通道",
    readout: "",
    keys: [
      { mark: "lit", label: "实心亮点：前向 12 Gbps 视频（大小 ∝ 3 GHz 分量幅度）" },
      { mark: "dim", label: "小空心点：反向 187.5 Mbps 控制数据" },
      { mark: "dashed", label: "虚线：PoC 直流供电，ECU → 摄像头" },
    ],
    caption: "数值出自 ADI《GMSL3 Channel Specification User Guide》Rev 4（2024-09）。亮点经过通道时按规格书插损上限变小，到解串器处恢复满幅：两跳是两段独立的 pin-to-pin 通道，插损不跨跳累加。点的速度是示意，实际快约十亿倍。",
    body: `<div class="iso-stage lk-stage" tabindex="0" role="group" aria-label="GMSL3 链路示意图。左右方向键逐个选择模块，L 切换长短通道，空格暂停。">${svg}</div>`,
  }) +
  panel +
  `<nav class="lk-nav"><a href="index.html"${THEME === "light" ? ' aria-current="page"' : ""}>浅色版</a><a href="dark.html"${THEME === "dark" ? ' aria-current="page"' : ""}>深色版</a><a href="https://github.com/wangbrightly/gmsl3-link-anatomy">源码 · GitHub</a></nav>` +
  `<button type="button" class="lk-reward-btn" data-reward>☕ 赞赏</button><div class="lk-reward" data-reward-box hidden><div class="lk-reward-card" role="dialog" aria-label="微信赞赏码"><img src="data:image/png;base64,${REWARD}" alt="微信赞赏码" width="280" height="280"><p>如果这张图帮你讲清楚了一件事，欢迎请作者喝杯咖啡</p><button type="button" data-reward-close>关闭</button></div></div>`;

const page = k.pageHtml({ title: "GMSL3 链路解剖", theme: THEME, body, script: kitScript() + MODEL + LIVE, width: 1120 }).replace('<html lang="en">', '<html lang="zh-CN">');
const name = THEME === "light" ? "index.html" : "dark.html";
writeFileSync(join(HERE, name), page);
console.log("wrote", name, `${(page.length / 1024).toFixed(0)} KB`, `${R.items.length} items`, `scale ${KS.toFixed(3)}`);
A.auditOrExit(R, P, {});
