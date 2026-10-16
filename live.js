
const D = __DATA__;
const stage = document.querySelector(".lk-stage");
const svg = stage.querySelector("svg");
const readout = document.querySelector("[data-readout]");
const detail = document.querySelector("[data-detail]");
const budgetBox = document.querySelector("[data-budget]");
const layer = svg.querySelector('[data-part="packets"]');
const pocLayer = svg.querySelector('[data-part="poc"]');
const picture = svg.querySelector('[data-part="picture"]');
const still = matchMedia("(prefers-reduced-motion: reduce)");
const NS = "http://www.w3.org/2000/svg";
const SEG = Object.fromEntries(D.segs.map((s) => [s.id, s]));
const ORDER = D.segs.map((s) => s.id);
const CHANNEL = { a1: "chA", ca: "chA", a2: "chA", b1: "chB", cb: "chB", b2: "chB" };

// ---------- 几何：每段折线的累积长度 ----------
function poly(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  return { points, cum, len: cum[cum.length - 1] };
}
function pointAt(p, s) {
  const t = Math.max(0, Math.min(p.len, s));
  let i = 1;
  while (i < p.cum.length - 1 && p.cum[i] < t) i++;
  const span = p.cum[i] - p.cum[i - 1] || 1;
  const f = (t - p.cum[i - 1]) / span;
  const a = p.points[i - 1];
  const b = p.points[i];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}
const PATH = Object.fromEntries(Object.entries(D.paths).map(([id, pts]) => [id, poly(pts)]));
const FWD = ["cam", "ser1", "a1", "ca", "a2", "des1", "soc", "ser2", "b1", "cb", "b2", "des2", "disp"];
const DUR = { cam: 0.55, ser1: 0.35, a1: 0.45, ca: 1.7, a2: 0.45, des1: 0.45, soc: 0.9, ser2: 0.35, b1: 0.45, cb: 1.7, b2: 0.45, des2: 0.35, disp: 0.75 };
const START = {};
let total = 0;
for (const id of FWD) { START[id] = total; total += DUR[id]; }

// ---------- 状态 ----------
let long = false;
let showRev = true;
let showPoc = true;
let running = !still.matches;
let selected = null;
let touring = true;
let tourClock = 0;
let tourIndex = 0;
let idleTimer = 0;

// 每段的插损分配（dB），来自 model：PCB / 线缆 / PCB
function lossOf(id) {
  const b = budget(long);
  if (id === "a1" || id === "a2" || id === "b1" || id === "b2") return b.pcb;
  if (id === "ca" || id === "cb") return b.cable;
  return 0;
}
// 前向点在路径上某处时的 3 GHz 分量幅度
function ampAt(id, f) {
  const b = budget(long);
  const chan = { a1: 0, ca: b.pcb, a2: b.pcb + b.cable, b1: 0, cb: b.pcb, b2: b.pcb + b.cable };
  if (id in chan) return amp(chan[id] + lossOf(id) * f);
  if (id === "des1" || id === "des2") {
    const end = amp(b.total);
    const g = Math.min(1, f / 0.7);
    return end + (1 - end) * g * g * (3 - 2 * g);
  }
  return 1;
}

// ---------- 信号点 ----------
const pool = [];
function dot(i, cls) {
  if (!pool[i]) {
    const c = document.createElementNS(NS, "circle");
    layer.appendChild(c);
    pool[i] = c;
  }
  const c = pool[i];
  if (c.getAttribute("class") !== cls) c.setAttribute("class", cls);
  return c;
}
const EMIT = 0.62;
const REV_EMIT = 1.7;
const REV_DUR = 3.4;
const REV = {
  chA: poly([...PATH.a2.points].reverse().concat([...PATH.ca.points].reverse(), [...PATH.a1.points].reverse())),
  chB: poly([...PATH.b2.points].reverse().concat([...PATH.cb.points].reverse(), [...PATH.b1.points].reverse())),
};
let clock = 0;
function drawPackets() {
  let n = 0;
  const first = Math.floor((clock - total) / EMIT) + 1;
  const last = Math.floor(clock / EMIT);
  for (let k = Math.max(0, first); k <= last; k++) {
    const age = clock - k * EMIT;
    if (age < 0 || age > total) continue;
    let id = FWD[0];
    for (const s of FWD) if (age >= START[s]) id = s;
    const f = (age - START[id]) / DUR[id];
    const p = pointAt(PATH[id], f * PATH[id].len);
    const a = ampAt(id, f);
    const c = dot(n++, "lk-pkt");
    c.setAttribute("cx", p[0].toFixed(1));
    c.setAttribute("cy", p[1].toFixed(1));
    c.setAttribute("r", (0.8 + 2.3 * a).toFixed(2));
    c.setAttribute("fill-opacity", (0.45 + 0.55 * a).toFixed(2));
    if (id === "disp" && f > 0.92 && picture) flash();
  }
  if (showRev) {
    for (const [ch, path] of Object.entries(REV)) {
      const lastR = Math.floor(clock / REV_EMIT);
      for (let k = Math.max(0, lastR - 3); k <= lastR; k++) {
        const age = clock - k * REV_EMIT - (ch === "chB" ? 0.6 : 0);
        if (age < 0 || age > REV_DUR) continue;
        const p = pointAt(path, (age / REV_DUR) * path.len);
        const c = dot(n++, "lk-rev");
        c.setAttribute("cx", p[0].toFixed(1));
        c.setAttribute("cy", p[1].toFixed(1));
        c.setAttribute("r", "1.25");
        c.removeAttribute("fill-opacity");
      }
    }
  }
  for (let i = n; i < pool.length; i++) if (pool[i].getAttribute("r") !== "0") pool[i].setAttribute("r", "0");
}
let flashUntil = 0;
function flash() {
  if (performance.now() < flashUntil) return;
  flashUntil = performance.now() + 260;
  picture.setAttribute("data-flash", "");
  setTimeout(() => picture.removeAttribute("data-flash"), 130);
}

// PoC：ECU 的 PoC 电感 → 线缆 → 摄像头板
function drawPoc() {
  pocLayer.innerHTML = "";
  if (!showPoc) return;
  const pts = [...PATH.a2.points].reverse().slice(1).concat([...PATH.ca.points].reverse(), [...PATH.a1.points].reverse().slice(0, 2));
  const p = document.createElementNS(NS, "path");
  p.setAttribute("class", "lk-poc");
  p.setAttribute("d", "M" + pts.map((q) => q[0].toFixed(1) + " " + q[1].toFixed(1)).join("L"));
  pocLayer.appendChild(p);
}

// ---------- 选择与说明 ----------
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const mark = (s) => esc(s).replace(/^待定/, '<span class="lk-tbd">待定</span>');
function shortLine(s) {
  const b = budget(long);
  const mode = long ? "长" : "短";
  if (s.il === "pcb") return `${s.num} ${s.name} · 插损 ≤ ${fmt(b.pcb)} dB @ 3 GHz`;
  if (s.il === "cable") return `${s.num} ${s.name} · 插损 ≤ ${fmt(b.cable)} dB @ 3 GHz（${mode}线）`;
  if (s.kind === "channel") return `${s.num} ${s.name} · 插损 ≤ ${fmt(b.limit, 0)} dB @ 3 GHz（${mode}通道）`;
  if (/^(ser|des)/.test(s.id)) return `${s.num} ${s.name} · 前向 12 Gbps PAM4 / 反向 187.5 Mbps`;
  return `${s.num} ${s.name}`;
}
function renderDetail(id) {
  const s = SEG[id ?? "chA"];
  const io = s.io.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${mark(v)}</dd>`).join("");
  const si = s.si.map((x) => `<li>${esc(x)}</li>`).join("");
  const parent = s.parent ? ` · 属于 ${esc(SEG[s.parent].num)} ${esc(SEG[s.parent].name)}` : "";
  detail.innerHTML = `<h2><span class="lk-num">${esc(s.num)}</span>${esc(s.name)}<span class="lk-note">${parent}</span>${pinned === id ? '<span class="lk-pin">· 已固定，点图中空白处或按 Esc 取消</span>' : ""}</h2><p>${esc(s.func)}</p><dl class="lk-io">${io}</dl><div class="lk-si-title">信号完整性关注点</div><ul class="lk-si">${si}</ul>`;
}
function renderBudget() {
  const b = budget(long);
  const scale = 20;
  const pct = (v) => ((v / scale) * 100).toFixed(2) + "%";
  const on = (k) => (selected === k || SEG[selected]?.parts?.includes(k) ? " data-on" : "");
  const dim = (ch) => (selected && (CHANNEL[selected] === ch || selected === ch) ? " data-dim" : "");
  const row = (ch, label, ids) => `<div class="lk-row"><span>${label}</span><span class="lk-bar"${dim(ch)}><span data-k="pcb"${on(ids[0])} style="width:${pct(b.pcb)}">${fmt(b.pcb)}</span><span data-k="cable"${on(ids[1])} style="width:${pct(b.cable)}">线缆 ${fmt(b.cable)}</span><span data-k="pcb"${on(ids[2])} style="width:${pct(b.pcb)}">${fmt(b.pcb)}</span><i class="lk-limit" style="left:${pct(b.limit)}"></i></span><span>${fmt(b.total)} / ${fmt(b.limit, 0)} dB</span></div>`;
  budgetBox.innerHTML = `<h3>插损预算 @ 3 GHz（${long ? "长" : "短"}通道，标尺 0–20 dB，竖线 = pin-to-pin 上限）</h3>${row("chA", "通道 A 3a·3b·3c", ["a1", "ca", "a2"])}${row("chB", "通道 B 7a·7b·7c", ["b1", "cb", "b2"])}<div class="lk-note">3 GHz 分量到达解串器时剩 ${fmt(amp(b.total) * 100, 1)}% 幅度；反向 93.75 MHz 处 pin-to-pin 上限只有 ${fmt(long ? D.rev.long : D.rev.short)} dB（Table 3）。两跳各自独立，不相加。</div>`;
}
function select(id, { from = "user" } = {}) {
  selected = id;
  const ids = id ? (SEG[id].parts ?? [id]) : [];
  svg.querySelectorAll("[data-on]").forEach((el) => el.removeAttribute("data-on"));
  for (const x of ids) svg.querySelectorAll(`.lk-bench [data-seg="${x}"]`).forEach((el) => el.setAttribute("data-on", ""));
  if (id) stage.setAttribute("data-sel", id); else stage.removeAttribute("data-sel");
  document.querySelectorAll(".lk-chip").forEach((b) => b.toggleAttribute("data-on", b.dataset.pick === id));
  readout.textContent = id ? shortLine(SEG[id]) : "";
  renderDetail(id);
  renderBudget();
  if (from === "user") holdTour();
}
function holdTour() {
  touring = false;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (inside || pinned) return; touring = true; tourClock = 0; kick(); }, 9000);
}

// ---------- 交互 ----------
// 悬停 = 预览（停留 90 ms 才切换，划过不算）；点击 = 固定，固定后悬停不再改说明，点空白处或 Esc 取消
let pinned = null;
let hoverTimer = 0;
let inside = false;
const segAt = (e) => e.target.closest && e.target.closest("[data-seg]");
stage.addEventListener("pointermove", (e) => {
  inside = true;
  holdTour();
  if (pinned) return;
  const el = segAt(e);
  const id = el ? el.dataset.seg : null;
  clearTimeout(hoverTimer);
  if (id && id !== selected) hoverTimer = setTimeout(() => select(id), 90);
});
stage.addEventListener("pointerleave", () => { inside = false; clearTimeout(hoverTimer); holdTour(); });
stage.addEventListener("click", (e) => {
  const el = segAt(e);
  if (el) { pinned = el.dataset.seg; select(pinned); }
  else { pinned = null; select(selected); }
  stage.focus({ preventScroll: true });
});
document.querySelectorAll(".lk-chip").forEach((b) => b.addEventListener("click", () => { pinned = b.dataset.pick; select(pinned); }));
function setMode(next) {
  long = next;
  document.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.mode === "long") === long)));
  select(selected, { from: "mode" });
}
document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => { setMode(b.dataset.mode === "long"); holdTour(); }));
document.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", () => {
  const on = b.getAttribute("aria-pressed") !== "true";
  b.setAttribute("aria-pressed", String(on));
  if (b.dataset.toggle === "rev") showRev = on;
  if (b.dataset.toggle === "poc") { showPoc = on; drawPoc(); }
  if (b.dataset.toggle === "run") { running = on; kick(); }
  drawPackets();
  holdTour();
}));
// 键盘：整页都响应（不必先点图）；按 code 判断，中文输入法下 L 也有效
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const onButton = e.target instanceof HTMLButtonElement;
  const i = ORDER.indexOf(selected);
  let handled = true;
  if (e.key === "ArrowRight" || e.key === "ArrowDown") pinned = ORDER[(i + 1) % ORDER.length];
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") pinned = ORDER[(i - 1 + ORDER.length) % ORDER.length];
  else if (e.code === "KeyL") { setMode(!long); holdTour(); }
  else if (e.code === "Space" && !onButton) document.querySelector('[data-toggle="run"]').click();
  else if (e.key === "Escape") { pinned = null; select(null); }
  else handled = false;
  if (!handled) return;
  e.preventDefault();
  if (/^Arrow/.test(e.key)) {
    select(pinned);
    // 焦点跟着选中项走：焦点框和选中高亮永远落在同一个按钮上
    if (document.activeElement instanceof HTMLButtonElement) document.querySelector(`.lk-chip[data-pick="${pinned}"]`)?.focus({ preventScroll: true });
  }
});

// ---------- 主循环 ----------
let frame = 0;
let lastT = 0;
let visible = false;
const TOUR = ["chA", "a1", "ca", "a2", "des1", "soc", "ser2", "chB", "cb", "des2", "disp", "cam", "ser1"];
function tick(now) {
  const dt = lastT ? Math.min((now - lastT) / 1000, 1 / 20) : 1 / 60;
  lastT = now;
  if (running) clock += dt;
  if (touring && !still.matches) {
    tourClock += dt;
    if (tourClock > 4.2) { tourClock = 0; tourIndex = (tourIndex + 1) % TOUR.length; select(TOUR[tourIndex], { from: "tour" }); }
  }
  drawPackets();
  frame = visible && (running || touring) ? requestAnimationFrame(tick) : 0;
}
function kick() { if (!frame && visible) { lastT = 0; frame = requestAnimationFrame(tick); } }
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) kick(); }, { rootMargin: "120px 0px" }).observe(stage);
if (still.matches) { running = false; touring = false; clock = 3.1; document.querySelector('[data-toggle="run"]').setAttribute("aria-pressed", "false"); }
drawPoc();
select(TOUR[0], { from: "tour" });
drawPackets();

// ---------- 赞赏码 ----------
const rewardBox = document.querySelector("[data-reward-box]");
const rewardBtn = document.querySelector("[data-reward]");
const closeReward = () => { rewardBox.hidden = true; rewardBtn.focus({ preventScroll: true }); };
rewardBtn.addEventListener("click", () => { rewardBox.hidden = false; rewardBox.querySelector("[data-reward-close]").focus(); });
rewardBox.addEventListener("click", (e) => { if (e.target === rewardBox || e.target.closest("[data-reward-close]")) closeReward(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !rewardBox.hidden) closeReward(); });
