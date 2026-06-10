/* ===================== Focus Tracker ===================== */
(function () {
  "use strict";

  /* ---------- nav routing ---------- */
  const screens = document.querySelectorAll(".screen");
  const railBtns = document.querySelectorAll(".rail-btn[data-screen]");
  function go(name) {
    screens.forEach((s) => s.classList.toggle("active", s.dataset.screen === name));
    railBtns.forEach((b) => b.classList.toggle("active", b.dataset.screen === name));
    const titleEl = document.querySelector(".head h1");
    const map = { dashboard: "Dashboard", projects: "Projects", analytics: "Analytics", documents: "Documents", calendar: "Calendar" };
    if (titleEl && map[name]) titleEl.textContent = map[name];
    document.querySelector(".main").scrollTo({ top: 0 });
    // (re)draw charts that live in the visible screen
    requestAnimationFrame(drawAllCharts);
  }
  railBtns.forEach((b) => b.addEventListener("click", () => go(b.dataset.screen)));

  /* ---------- generic toggles ---------- */
  function groupToggle(sel) {
    document.querySelectorAll(sel).forEach((group) => {
      group.querySelectorAll("button").forEach((btn) => {
        btn.addEventListener("click", () => {
          group.querySelectorAll("button").forEach((b) => b.classList.remove("on"));
          btn.classList.add("on");
          if (group.classList.contains("seg")) requestAnimationFrame(drawAllCharts);
        });
      });
    });
  }
  groupToggle(".seg");
  groupToggle(".theme-toggle");
  document.querySelectorAll(".chart-tools .chip[data-range]").forEach((c) => {
    c.addEventListener("click", () => {
      c.parentElement.querySelectorAll(".chip[data-range]").forEach((x) => x.classList.remove("on"));
      c.classList.add("on");
      drawAllCharts();
    });
  });

  /* stars */
  document.querySelectorAll(".task .star").forEach((s) =>
    s.addEventListener("click", () => s.classList.toggle("on"))
  );

  /* ---------- focus timer ---------- */
  let running = true;
  let elapsed = 57 * 60 + 56; // 00:57:56
  const limit = 6 * 3600;
  const todayEl = document.getElementById("timerToday");
  const ringEl = document.getElementById("dialRing");
  const btnEl = document.getElementById("dialBtn");
  const pauseIcon = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="3.6" height="14" rx="1.4"/><rect x="13.9" y="5" width="3.6" height="14" rx="1.4"/></svg>';
  const playIcon = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.2v13.6c0 .9 1 1.45 1.76.97l10.5-6.8a1.16 1.16 0 0 0 0-1.94L9.76 4.23A1.16 1.16 0 0 0 8 5.2z"/></svg>';
  function fmt(s) {
    const h = String(Math.floor(s / 3600)).padStart(2, "0");
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${h}:${m}:${ss}`;
  }
  const RC = 2 * Math.PI * 70;
  function paintTimer() {
    if (todayEl) todayEl.textContent = fmt(elapsed);
    if (ringEl) {
      const frac = Math.min(elapsed / limit, 1);
      ringEl.style.strokeDasharray = RC;
      ringEl.style.strokeDashoffset = RC * (1 - frac);
    }
  }
  if (btnEl) {
    btnEl.innerHTML = running ? pauseIcon : playIcon;
    btnEl.addEventListener("click", () => {
      running = !running;
      btnEl.innerHTML = running ? pauseIcon : playIcon;
    });
  }
  paintTimer();
  setInterval(() => { if (running) { elapsed++; paintTimer(); } }, 1000);

  /* ---------- now-line position in timeline ---------- */
  function placeNowLine() {
    const line = document.getElementById("nowLine");
    const body = document.getElementById("tlBody");
    if (!line || !body) return;
    // 09:00 at row top, each hour = 150px. now = 10:28 -> 1.4667h
    const top = 1.4667 * 150 + 10; // +10 padding
    line.style.top = top + "px";
  }
  placeNowLine();

  /* =================== CHARTS =================== */
  const SVGNS = "http://www.w3.org/2000/svg";
  function el(tag, attrs) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  // deterministic pseudo-random
  function makeSeries(seed, n, base, vol, trend) {
    let v = base, s = seed;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const out = [];
    for (let i = 0; i < n; i++) {
      v += (rnd() - 0.5) * vol + trend;
      // occasional jumps for a trading-like feel
      if (rnd() > 0.94) v += (rnd() - 0.45) * vol * 4;
      out.push(v);
    }
    return out;
  }

  function rangePoints(range) {
    if (range === "day") return makeSeries(7, 90, 62, 3.2, 0.18);
    if (range === "month") return makeSeries(21, 130, 48, 4.5, 0.16);
    if (range === "year") return makeSeries(99, 140, 30, 6, 0.30);
    return makeSeries(42, 110, 55, 3.6, 0.22); // week
  }

  function drawArea(svg, data, opts) {
    opts = opts || {};
    const W = svg.clientWidth || svg.parentElement.clientWidth;
    const H = opts.height || 300;
    if (!W) return;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const padR = opts.axis === false ? 8 : 56;
    const padB = opts.axis === false ? 6 : 26;
    const padT = 12, padL = opts.axis === false ? 2 : 8;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const min = Math.min(...data), max = Math.max(...data);
    const pad = (max - min) * 0.12 || 1;
    const lo = min - pad, hi = max + pad;
    const x = (i) => padL + (i / (data.length - 1)) * plotW;
    const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * plotH;

    const uid = "g" + Math.random().toString(36).slice(2, 8);
    const defs = el("defs", {});
    const grad = el("linearGradient", { id: uid, x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.appendChild(el("stop", { offset: "0%", "stop-color": "#2fe08a", "stop-opacity": "0.34" }));
    grad.appendChild(el("stop", { offset: "55%", "stop-color": "#2fe08a", "stop-opacity": "0.10" }));
    grad.appendChild(el("stop", { offset: "100%", "stop-color": "#2fe08a", "stop-opacity": "0" }));
    defs.appendChild(grad);
    svg.appendChild(defs);

    // gridlines + y labels
    if (opts.axis !== false) {
      const ticks = 5;
      for (let t = 0; t <= ticks; t++) {
        const gv = lo + (hi - lo) * (t / ticks);
        const gy = y(gv);
        svg.appendChild(el("line", { x1: padL, y1: gy, x2: padL + plotW, y2: gy, stroke: "rgba(255,255,255,0.04)", "stroke-width": 1 }));
        const lab = el("text", { x: W - 8, y: gy + 4, fill: "#54545e", "font-size": 11, "text-anchor": "end", "font-family": "JetBrains Mono, monospace" });
        lab.textContent = gv.toFixed(1);
        svg.appendChild(lab);
      }
    }

    // build line + area paths
    let line = `M ${x(0)} ${y(data[0])}`;
    for (let i = 1; i < data.length; i++) line += ` L ${x(i)} ${y(i, data) || y(data[i])}`;
    // (rebuild cleanly)
    line = `M ${x(0)} ${y(data[0])}`;
    for (let i = 1; i < data.length; i++) line += ` L ${x(i)} ${y(data[i])}`;
    const area = line + ` L ${x(data.length - 1)} ${padT + plotH} L ${x(0)} ${padT + plotH} Z`;

    svg.appendChild(el("path", { d: area, fill: `url(#${uid})` }));
    const linePath = el("path", { d: line, fill: "none", stroke: "#2fe08a", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round", filter: opts.glow === false ? "" : "drop-shadow(0 0 6px rgba(47,224,138,0.45))" });
    svg.appendChild(linePath);

    // animate draw
    if (opts.animate !== false) {
      const len = linePath.getTotalLength();
      linePath.style.strokeDasharray = len;
      linePath.style.strokeDashoffset = len;
      linePath.getBoundingClientRect();
      linePath.style.transition = "stroke-dashoffset 1.1s cubic-bezier(.4,0,.2,1)";
      linePath.style.strokeDashoffset = "0";
    }

    // current dashed line + tag
    if (opts.axis !== false) {
      const cur = data[data.length - 1];
      const cy = y(cur);
      const dl = el("line", { x1: padL, y1: cy, x2: padL + plotW, y2: cy, stroke: "#f0552d", "stroke-width": 1, "stroke-dasharray": "5 5", opacity: 0.85 });
      svg.appendChild(dl);
      const tagW = 46;
      svg.appendChild(el("rect", { x: W - tagW - 2, y: cy - 10, width: tagW, height: 20, rx: 5, fill: "#f0552d" }));
      const tg = el("text", { x: W - tagW / 2 - 2, y: cy + 4, fill: "#fff", "font-size": 11, "text-anchor": "middle", "font-family": "JetBrains Mono, monospace", "font-weight": 700 });
      tg.textContent = cur.toFixed(1);
      svg.appendChild(tg);

      // end dot
      svg.appendChild(el("circle", { cx: x(data.length - 1), cy: cy, r: 3.5, fill: "#2fe08a", stroke: "#08080a", "stroke-width": 1.5 }));
    }

    // x axis labels
    if (opts.axis !== false && opts.xlabels) {
      const labs = opts.xlabels;
      labs.forEach((t, i) => {
        const px = padL + (i / (labs.length - 1)) * plotW;
        const tx = el("text", { x: px, y: H - 8, fill: "#54545e", "font-size": 10.5, "text-anchor": i === 0 ? "start" : i === labs.length - 1 ? "end" : "middle", "font-family": "JetBrains Mono, monospace" });
        tx.textContent = t;
        svg.appendChild(tx);
      });
    }

    // interactivity
    if (opts.tip) {
      const tip = opts.tip;
      const cross = el("line", { y1: padT, y2: padT + plotH, stroke: "rgba(255,255,255,0.18)", "stroke-width": 1, opacity: 0 });
      const dot = el("circle", { r: 4, fill: "#2fe08a", stroke: "#08080a", "stroke-width": 1.5, opacity: 0 });
      svg.appendChild(cross); svg.appendChild(dot);
      const rect = svg.getBoundingClientRect();
      function move(ev) {
        const mx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - svg.getBoundingClientRect().left;
        let i = Math.round(((mx - padL) / plotW) * (data.length - 1));
        i = Math.max(0, Math.min(data.length - 1, i));
        const px = x(i), py = y(data[i]);
        cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("opacity", 1);
        dot.setAttribute("cx", px); dot.setAttribute("cy", py); dot.setAttribute("opacity", 1);
        tip.style.opacity = 1;
        tip.style.left = px + "px";
        tip.style.top = (py - 12) + "px";
        const lbl = opts.tipLabel ? opts.tipLabel(i, data.length) : "";
        tip.innerHTML = `<div class="v">${data[i].toFixed(1)}%</div><div class="l">${lbl}</div>`;
      }
      function leave() { cross.setAttribute("opacity", 0); dot.setAttribute("opacity", 0); tip.style.opacity = 0; }
      svg.onmousemove = move; svg.onmouseleave = leave;
      svg.ontouchmove = move; svg.ontouchend = leave;
    }
  }

  function currentRange() {
    const seg = document.querySelector(".chart-tools .chip.on[data-range]");
    return seg ? seg.dataset.range : "week";
  }

  function drawFocusChart() {
    const svg = document.getElementById("focusChart");
    if (!svg || !svg.clientWidth) return;
    const range = currentRange();
    const data = rangePoints(range);
    const cur = data[data.length - 1];
    const hi = Math.max(...data), lo = Math.min(...data);
    const nowBig = document.getElementById("focusNow");
    const hiEl = document.getElementById("focusHi");
    const loEl = document.getElementById("focusLo");
    if (nowBig) nowBig.childNodes[0].nodeValue = cur.toFixed(1) + "% ";
    if (hiEl) hiEl.textContent = hi.toFixed(1) + "%";
    if (loEl) loEl.textContent = lo.toFixed(1) + "%";
    const xl = {
      day: ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00"],
      week: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      month: ["W1", "W2", "W3", "W4"],
      year: ["Jan", "Mar", "May", "Jul", "Sep", "Nov"],
    }[range];
    drawArea(svg, data, {
      height: 300,
      xlabels: xl,
      tip: document.getElementById("focusTip"),
      tipLabel: (i, n) => {
        if (range === "week") return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][Math.floor(i / n * 7)] + " · focus score";
        if (range === "day") return "Hour " + Math.floor(8 + i / n * 10) + ":00";
        return "Sample " + (i + 1);
      },
    });
  }

  function drawMiniChart() {
    const svg = document.getElementById("miniChart");
    if (!svg || !svg.clientWidth) return;
    drawArea(svg, makeSeries(13, 60, 50, 3, 0.25), { height: 90, axis: false });
  }

  function drawAllCharts() {
    drawFocusChart();
    drawMiniChart();
  }

  // initial draw (wait a beat for fonts/layout)
  let drawn = false;
  function init() { if (drawn) return; if (document.getElementById("focusChart") && document.getElementById("focusChart").clientWidth) { drawn = true; drawAllCharts(); } }
  requestAnimationFrame(init);
  setTimeout(() => { drawn = false; drawAllCharts(); }, 250);
  window.addEventListener("load", () => { drawn = false; drawAllCharts(); });

  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { drawAllCharts(); }, 120); });
})();
