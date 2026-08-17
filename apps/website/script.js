document.querySelectorAll(".dropdown > .dropdown-trigger").forEach((trigger) => {
  trigger.setAttribute("aria-expanded", "false");
  const dropdown = trigger.parentElement;
  const setOpen = (isOpen) => {
    dropdown.classList.toggle("open", isOpen);
    trigger.setAttribute("aria-expanded", String(isOpen));
  };

  dropdown.addEventListener("mouseenter", () => setOpen(true));
  dropdown.addEventListener("mouseleave", () => setOpen(false));
  dropdown.addEventListener("focusin", () => setOpen(true));
  dropdown.addEventListener("focusout", (event) => {
    if (!dropdown.contains(event.relatedTarget)) {
      setOpen(false);
    }
  });
});

const savedTheme = localStorage.getItem("spinvault-theme");
if (savedTheme === "light") {
  document.body.classList.add("light");
}

document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
  const updateState = () => {
    const isLight = document.body.classList.contains("light");
    button.setAttribute("aria-pressed", String(isLight));
    button.setAttribute("title", isLight ? "Switch to dark mode" : "Switch to light mode");
  };

  updateState();
  button.addEventListener("click", () => {
    document.documentElement.classList.add("theme-transition");
    document.body.classList.toggle("light");
    localStorage.setItem("spinvault-theme", document.body.classList.contains("light") ? "light" : "dark");
    updateState();
    window.dispatchEvent(new Event("spinvault-theme-change"));
    window.setTimeout(() => document.documentElement.classList.remove("theme-transition"), 650);
  });
});

if (typeof CanvasRenderingContext2D !== "undefined" && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function roundRect(x, y, w, h, radius = 0) {
    const radii = Array.isArray(radius)
      ? radius
      : [radius, radius, radius, radius];
    const [r1, r2, r3, r4] = radii.map((value) => Math.max(0, Number(value) || 0));
    const maxRadius = Math.min(Math.abs(w) / 2, Math.abs(h) / 2);
    const [a, b, c, d] = [r1, r2, r3, r4].map((value) => Math.min(value, maxRadius));
    this.beginPath();
    this.moveTo(x + a, y);
    this.lineTo(x + w - b, y);
    this.quadraticCurveTo(x + w, y, x + w, y + b);
    this.lineTo(x + w, y + h - c);
    this.quadraticCurveTo(x + w, y + h, x + w - c, y + h);
    this.lineTo(x + d, y + h);
    this.quadraticCurveTo(x, y + h, x, y + h - d);
    this.lineTo(x, y + a);
    this.quadraticCurveTo(x, y, x + a, y);
    this.closePath();
    return this;
  };
}

// Cookie and privacy controls live in the footer pages so they never obscure product visuals.

const COOKIE_STORAGE_KEY = "spinvault-cookie-choice";
const COOKIE_CHOICES = {
  accepted: "accepted",
  essential: "essential"
};

const bindCookieButtons = (root = document) => {
  root.querySelectorAll("[data-cookie-choice]").forEach((button) => {
    if (button.dataset.cookieBound === "true") return;
    button.dataset.cookieBound = "true";
    button.addEventListener("click", () => {
      const choice = button.dataset.cookieChoice || COOKIE_CHOICES.essential;
      localStorage.setItem(COOKIE_STORAGE_KEY, choice);
      document.querySelector(".cookie-banner")?.classList.remove("show");
      const analyticsToggle = document.querySelector("[data-cookie-analytics-toggle]");
      if (analyticsToggle) {
        analyticsToggle.checked = choice === COOKIE_CHOICES.accepted;
      }
      const status = document.querySelector("[data-cookie-status]");
      if (status) {
        status.textContent = choice === COOKIE_CHOICES.accepted ? "All optional cookies allowed" : "Only essential storage enabled";
      }
    });
  });
};

const syncCookiePreferenceState = () => {
  const choice = localStorage.getItem(COOKIE_STORAGE_KEY);
  const status = document.querySelector("[data-cookie-status]");
  if (status) {
    status.textContent = choice === COOKIE_CHOICES.accepted
      ? "All optional cookies allowed"
      : choice === COOKIE_CHOICES.essential
        ? "Only essential storage enabled"
        : "Choose a preference";
  }
};

const injectCookieBanner = () => {
  if (localStorage.getItem(COOKIE_STORAGE_KEY)) return;
  if (document.querySelector(".cookie-banner")) return;
  const banner = document.createElement("aside");
  banner.className = "cookie-banner show";
  banner.setAttribute("role", "dialog");
  banner.setAttribute("aria-label", "Cookie preferences");
  banner.innerHTML = `
    <div class="cookie-banner-copy">
      <p class="cookie-eyebrow">Cookie settings</p>
      <h3>We use cookies to keep SpinVault running smoothly.</h3>
      <p>Essential storage remembers your theme and cookie choice. Optional analytics stay off unless you choose to enable them.</p>
    </div>
    <div class="cookie-actions">
      <a class="btn subtle" href="cookies.html">Cookie settings</a>
      <button class="btn" type="button" data-cookie-choice="essential">Essential only</button>
      <button class="btn primary" type="button" data-cookie-choice="accepted">Accept all</button>
    </div>
  `;
  document.body.appendChild(banner);
  bindCookieButtons(banner);
};

document.addEventListener("click", (event) => {
  document.querySelectorAll(".dropdown.open").forEach((dropdown) => {
    if (!dropdown.contains(event.target)) {
      dropdown.classList.remove("open");
      dropdown.querySelector(".dropdown-trigger")?.setAttribute("aria-expanded", "false");
    }
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  document.querySelectorAll(".dropdown.open").forEach((dropdown) => {
    dropdown.classList.remove("open");
    dropdown.querySelector(".dropdown-trigger")?.setAttribute("aria-expanded", "false");
  });
});

bindCookieButtons();
injectCookieBanner();
syncCookiePreferenceState();

const revealGroups = document.querySelectorAll("[data-reveal-group]");
if ("IntersectionObserver" in window) {
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      revealObserver.unobserve(entry.target);
    });
  }, { threshold: 0.24 });

  revealGroups.forEach((group) => revealObserver.observe(group));
} else {
revealGroups.forEach((group) => group.classList.add("is-visible"));
}

document.querySelectorAll(".math-graph-card svg").forEach((svg) => {
  svg.setAttribute("tabindex", "0");
  svg.style.cursor = "crosshair";
});

const reskinGraphCanvases = document.querySelectorAll("[data-reskin-graph]");
if (reskinGraphCanvases.length) {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const escapeHtml = (value) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  const cssColor = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#000";
  const GRAPH_FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const ENERGY_MIN = 0.05;
  const ENERGY_MAX = 3.3;
  const svgNs = "http://www.w3.org/2000/svg";
  const makeSvgEl = (name, attrs = {}) => {
    const el = document.createElementNS(svgNs, name);
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, String(value)));
    return el;
  };
  const pathFromPoints = (points, xScale, yScale) => points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${xScale(point.x).toFixed(2)} ${yScale(point.y).toFixed(2)}`)
    .join(" ");

  const transmissionSeries = (width) => {
    const points = Array.from({ length: 96 }, (_, index) => {
      const e = ENERGY_MIN + ((ENERGY_MAX - ENERGY_MIN) * index) / 95;
      const up = Math.min(1, Math.log10(1 + Math.exp(8 * (e - 2.92))) / 2.4);
      const down = Math.min(1, Math.log10(1 + Math.exp(8 * (e - 2.84))) / 2.4);
      return { e, up, down };
    });
    const sampleAt = (e, key) => points.reduce((best, point) => (
      Math.abs(point.e - e) < Math.abs(best.e - e) ? point : best
    ), points[0])[key];
    const hover = clamp(width, ENERGY_MIN, ENERGY_MAX);
    const effectiveUp = sampleAt(hover, "up");
    const effectiveDown = sampleAt(hover, "down");
    return { points, hover, effectiveUp, effectiveDown };
  };

  const waveSeries = () => {
    const waveUp = Array.from({ length: 180 }, (_, index) => {
      const x = index / 179;
      const y = x < 0.38 ? 0.34 + 0.22 * Math.sin(x * 14) ** 2
        : x <= 0.58 ? Math.exp(-(x - 0.38) * 10)
          : 0.08 + 0.22 * Math.sin(x * 15) ** 2;
      return { x, y: clamp(y, 0, 1) };
    });
    const waveDown = waveUp.map((point, index) => ({ x: point.x, y: clamp(point.y * (0.86 - 0.18 * Math.exp(-index / 40)), 0, 1) }));
    return { waveUp, waveDown };
  };

  const renderTransmission = (host, hoverRatio = 0.78) => {
    const rect = host.getBoundingClientRect();
    const w = Math.max(900, rect.width || 900);
    const h = Math.max(550, rect.height || 550);
    const margin = { top: 78, right: 40, bottom: 92, left: 92 };
    const plotW = w - margin.left - margin.right;
    const plotH = h - margin.top - margin.bottom;
    const xScale = (e) => margin.left + ((e - ENERGY_MIN) / (ENERGY_MAX - ENERGY_MIN)) * plotW;
    const yScale = (y) => margin.top + (1 - y) * plotH;
    const { points } = transmissionSeries(hoverRatio);
    const upPath = pathFromPoints(points.map((p) => ({ x: p.e, y: p.up })), xScale, yScale);
    const downPath = pathFromPoints(points.map((p) => ({ x: p.e, y: p.down })), xScale, yScale);
    const cursorE = ENERGY_MIN + clamp(hoverRatio, 0, 1) * (ENERGY_MAX - ENERGY_MIN);
    const cursorX = xScale(cursorE);
    const cursorDown = points.reduce((best, point) => (Math.abs(point.e - cursorE) < Math.abs(best.e - cursorE) ? point : best), points[0]);
    const cursorUp = cursorDown;
    const refX = xScale(0.5);
    const veffDown = xScale(2.960);
    const veffUp = xScale(3.040);
    const isLight = document.body.classList.contains("light");
    const theme = isLight
      ? {
        bg: "#ffffff",
        grid: "rgba(18,20,23,0.08)",
        axis: "rgba(18,20,23,0.6)",
        title: "rgba(70,70,70,1)",
        ink: "rgba(70,70,70,1)",
        muted: "rgba(70,70,70,0.78)",
        legend: "rgba(70,70,70,1)",
        panel: "rgba(255,255,255,0.96)",
        panelLine: "rgba(18,20,23,0.12)",
        barrier: "rgba(160,160,160,0.45)"
      }
      : {
        bg: "#05070a",
        grid: "rgba(255,255,255,0.08)",
        axis: "rgba(255,255,255,0.64)",
        title: "rgba(243,246,251,0.96)",
        ink: "rgba(243,246,251,0.96)",
        muted: "rgba(243,246,251,0.74)",
        legend: "rgba(243,246,251,0.9)",
        panel: "rgba(4,9,14,0.9)",
        panelLine: "rgba(79,212,255,0.16)",
        barrier: "rgba(160,160,160,0.42)"
      };
    const svg = makeSvgEl("svg", { viewBox: `0 0 ${w} ${h}`, width: "100%", height: "100%", role: "img", "aria-label": "Transmission probability vs electron energy" });
    svg.append(
      makeSvgEl("rect", { x: 0, y: 0, width: w, height: h, fill: theme.bg, rx: 0 }),
      makeSvgEl("text", { x: w / 2, y: 40, "text-anchor": "middle", fill: theme.title, "font-family": GRAPH_FONT, "font-size": 18, "font-weight": 700, "dominant-baseline": "middle" })
    );
    svg.lastChild.textContent = "Transmission probability vs. electron energy";
    for (let i = 0; i <= 5; i += 1) {
      const x = margin.left + (plotW * i) / 5;
      svg.append(makeSvgEl("line", { x1: x, y1: margin.top, x2: x, y2: margin.top + plotH, stroke: theme.grid, "stroke-width": 1 }));
    }
    for (let i = 0; i <= 4; i += 1) {
      const y = margin.top + (plotH * i) / 4;
      svg.append(makeSvgEl("line", { x1: margin.left, y1: y, x2: margin.left + plotW, y2: y, stroke: theme.grid, "stroke-width": 1 }));
    }
    svg.append(
      makeSvgEl("line", { x1: margin.left, y1: margin.top, x2: margin.left, y2: margin.top + plotH, stroke: theme.axis, "stroke-width": 1.5 }),
      makeSvgEl("line", { x1: margin.left, y1: margin.top + plotH, x2: margin.left + plotW, y2: margin.top + plotH, stroke: theme.axis, "stroke-width": 1.5 }),
      makeSvgEl("line", { x1: refX, y1: margin.top, x2: refX, y2: margin.top + plotH, stroke: "green", "stroke-width": 2, "stroke-dasharray": "4 6" }),
      makeSvgEl("line", { x1: veffDown, y1: margin.top, x2: veffDown, y2: margin.top + plotH, stroke: "#ff3b30", "stroke-width": 1.5, "stroke-dasharray": "10 10" }),
      makeSvgEl("line", { x1: veffUp, y1: margin.top, x2: veffUp, y2: margin.top + plotH, stroke: "#3a44ff", "stroke-width": 1.5, "stroke-dasharray": "10 10" }),
      makeSvgEl("path", { d: upPath, fill: "none", stroke: "#2e3cff", "stroke-width": 4.5, "stroke-linecap": "round" }),
      makeSvgEl("path", { d: downPath, fill: "none", stroke: "#ff150f", "stroke-width": 4.5, "stroke-linecap": "round" })
    );
    const addText = (text, x, y, color, size = 12, anchor = "start") => {
      const el = makeSvgEl("text", { x, y, fill: color, "font-family": GRAPH_FONT, "font-size": size, "text-anchor": anchor });
      el.textContent = text;
      svg.append(el);
      return el;
    };
    addText("Reference energy", refX + 8, margin.top - 6, "green", 12);
    addText("Veff↓ = 2.960 eV", veffDown - 8, margin.top - 6, "#ff3b30", 12, "end");
    addText("Veff↑ = 3.040 eV", veffUp + 8, margin.top - 6, "#2e3cff", 12, "start");
    addText("Spin-up (↓)", margin.left + 24, margin.top + 28, "#2e3cff", 14);
    addText("Spin-down (↑)", margin.left + 24, margin.top + 54, "#ff150f", 14);
    svg.append(
      makeSvgEl("line", { x1: margin.left + 2, y1: margin.top + 22, x2: margin.left + 22, y2: margin.top + 22, stroke: "#2e3cff", "stroke-width": 4 }),
      makeSvgEl("line", { x1: margin.left + 2, y1: margin.top + 48, x2: margin.left + 22, y2: margin.top + 48, stroke: "#ff150f", "stroke-width": 4 })
    );
    addText("Electron energy E (eV)", w / 2, h - 20, theme.title, 14, "middle");
    addText("Transmission probability T", 22, h / 2, theme.title, 14, "middle").setAttribute("transform", `rotate(-90 22 ${h / 2})`);
    addText("E = 0.500 eV", margin.left + 6, h - 136, theme.ink, 12);
    addText(`T↓ = ${cursorDown.down.toExponential(3)}`, margin.left + 6, h - 114, theme.ink, 12);
    addText(`T↑ = ${cursorUp.up.toExponential(3)}`, margin.left + 6, h - 92, theme.ink, 12);
    const cursorLine = makeSvgEl("line", { x1: cursorX, y1: margin.top, x2: cursorX, y2: margin.top + plotH, stroke: "#ffd166", "stroke-width": 1.6, "stroke-dasharray": "8 8" });
    svg.append(cursorLine);
    return { svg, hoverText: `E = ${cursorE.toFixed(3)} eV | T↓ = ${cursorDown.down.toExponential(3)} | T↑ = ${cursorUp.up.toExponential(3)}` };
  };

  const renderWave = (host, hoverRatio = 0.5) => {
    const rect = host.getBoundingClientRect();
    const w = Math.max(900, rect.width || 900);
    const h = Math.max(550, rect.height || 550);
    const margin = { top: 78, right: 40, bottom: 92, left: 92 };
    const plotW = w - margin.left - margin.right;
    const plotH = h - margin.top - margin.bottom;
    const xScale = (x) => margin.left + x * plotW;
    const yScale = (y) => margin.top + (1 - y) * (plotH * 0.78);
    const { waveUp, waveDown } = waveSeries();
    const barrierLeft = margin.left + 0.39 * plotW;
    const barrierRight = margin.left + 0.58 * plotW;
    const isLight = document.body.classList.contains("light");
    const theme = isLight
      ? {
        bg: "#ffffff",
        grid: "rgba(18,20,23,0.08)",
        axis: "rgba(18,20,23,0.6)",
        title: "rgba(70,70,70,1)",
        ink: "rgba(70,70,70,1)",
        muted: "rgba(70,70,70,0.78)",
        legend: "rgba(70,70,70,1)",
        barrier: "rgba(160,160,160,0.45)"
      }
      : {
        bg: "#05070a",
        grid: "rgba(255,255,255,0.08)",
        axis: "rgba(255,255,255,0.64)",
        title: "rgba(243,246,251,0.96)",
        ink: "rgba(243,246,251,0.96)",
        muted: "rgba(243,246,251,0.74)",
        legend: "rgba(243,246,251,0.9)",
        barrier: "rgba(160,160,160,0.42)"
      };
    const svg = makeSvgEl("svg", { viewBox: `0 0 ${w} ${h}`, width: "100%", height: "100%", role: "img", "aria-label": "Electron wavefunction probability density across the barrier" });
    svg.append(makeSvgEl("rect", { x: 0, y: 0, width: w, height: h, fill: theme.bg }));
    for (let i = 0; i <= 5; i += 1) {
      const x = margin.left + (plotW * i) / 5;
      svg.append(makeSvgEl("line", { x1: x, y1: margin.top, x2: x, y2: margin.top + plotH, stroke: theme.grid, "stroke-width": 1 }));
    }
    for (let i = 0; i <= 4; i += 1) {
      const y = margin.top + (plotH * i) / 4;
      svg.append(makeSvgEl("line", { x1: margin.left, y1: y, x2: margin.left + plotW, y2: y, stroke: theme.grid, "stroke-width": 1 }));
    }
    svg.append(
      makeSvgEl("line", { x1: margin.left, y1: margin.top, x2: margin.left, y2: margin.top + plotH, stroke: theme.axis, "stroke-width": 1.5 }),
      makeSvgEl("line", { x1: margin.left, y1: margin.top + plotH, x2: margin.left + plotW, y2: margin.top + plotH, stroke: theme.axis, "stroke-width": 1.5 }),
      makeSvgEl("rect", { x: barrierLeft, y: margin.top + 6, width: barrierRight - barrierLeft, height: plotH - 12, fill: theme.barrier }),
      makeSvgEl("line", { x1: barrierLeft, y1: margin.top, x2: barrierLeft, y2: margin.top + plotH, stroke: isLight ? "rgba(18,20,23,0.9)" : "rgba(255,255,255,0.92)", "stroke-width": 2, "stroke-dasharray": "4 6" }),
      makeSvgEl("line", { x1: barrierRight, y1: margin.top, x2: barrierRight, y2: margin.top + plotH, stroke: isLight ? "rgba(18,20,23,0.9)" : "rgba(255,255,255,0.92)", "stroke-width": 2, "stroke-dasharray": "4 6" }),
      makeSvgEl("path", { d: pathFromPoints(waveUp, xScale, yScale), fill: "none", stroke: "#2e3cff", "stroke-width": 4.5, "stroke-linecap": "round" }),
      makeSvgEl("path", { d: pathFromPoints(waveDown, xScale, yScale), fill: "none", stroke: "#ff150f", "stroke-width": 4.5, "stroke-linecap": "round" })
    );
    const addText = (text, x, y, color, size = 12, anchor = "start") => {
      const el = makeSvgEl("text", { x, y, fill: color, "font-family": GRAPH_FONT, "font-size": size, "text-anchor": anchor });
      el.textContent = text;
      svg.append(el);
      return el;
    };
    addText("Electron wavefunction probability density (FMI exchange coupling)", w / 2, 40, theme.title, 18, "middle");
    addText("m(t)", margin.left + 20, margin.top + 14, theme.ink, 14);
    addText("time", margin.left + plotW * 0.62, h - 20, theme.ink, 14);
    addText("Position (nm)", w / 2, h - 20, theme.ink, 14, "middle");
    addText("Probability density |ψ|²", 22, h / 2, theme.ink, 14, "middle").setAttribute("transform", `rotate(-90 22 ${h / 2})`);
    addText("• Barrier region", barrierLeft - 8, margin.top - 10, "#2ca02c", 12);
    addText("─ |ψ↑|² (Spin up)", w - 260, margin.top + 20, "#2e3cff", 14);
    addText("─ |ψ↓|² (Spin down)", w - 260, margin.top + 46, "#ff150f", 14);
    addText("─ barrier (scaled)", w - 260, margin.top + 72, theme.muted, 14);
    return { svg, hoverText: `x = ${Math.round(clamp(hoverRatio, 0, 1) * 100)}%` };
  };

  reskinGraphCanvases.forEach((host) => {
    const graphType = host.dataset.reskinGraph;
    const stage = host.closest("[data-reskin-stage]");
    const tooltip = stage?.querySelector("[data-reskin-tooltip]");
    const draw = (event) => {
      const rect = host.getBoundingClientRect();
      const point = event ? (event.touches?.[0] || event.changedTouches?.[0] || event) : null;
      const hoverRatio = point ? clamp((point.clientX - rect.left) / Math.max(1, rect.width), 0, 1) : 0.78;
      const result = graphType === "wave-density" ? renderWave(host, hoverRatio) : renderTransmission(host, hoverRatio);
      host.replaceChildren(result.svg);
      if (!tooltip) return;
      if (!point) {
        tooltip.hidden = true;
        return;
      }
      tooltip.hidden = false;
      const stageRect = stage?.getBoundingClientRect() || rect;
      const leftPx = Math.max(12, Math.min(stageRect.width - 292, point.clientX - stageRect.left + 18));
      const topPx = Math.max(12, Math.min(stageRect.height - 96, point.clientY - stageRect.top - 18));
      tooltip.style.left = `${leftPx}px`;
      tooltip.style.top = `${topPx}px`;
      tooltip.style.transform = "translate(0, 0)";
      tooltip.textContent = result.hoverText;
    };
    host.setAttribute("tabindex", "0");
    host.addEventListener("pointermove", draw);
    host.addEventListener("pointerleave", () => {
      if (tooltip) tooltip.hidden = true;
      draw();
    });
    host.addEventListener("mouseenter", draw);
    host.addEventListener("touchstart", draw, { passive: true });
    host.addEventListener("touchmove", draw, { passive: true });
    draw();
  });
  window.addEventListener("resize", () => {
    reskinGraphCanvases.forEach((host) => host.dispatchEvent(new Event("mouseenter")));
  });
  window.addEventListener("spinvault-theme-change", () => {
    reskinGraphCanvases.forEach((host) => host.dispatchEvent(new Event("mouseenter")));
  });
}

document.querySelectorAll("[data-sim-lab]").forEach((lab) => {
  let simMode = "nand";
  let simView = "wave";
  let cellState = 1;
  let previousCellState = 1;
  let switchStartedAt = performance.now();
  const modeButtons = Array.from(lab.querySelectorAll("[data-sim-mode]"));
  const viewButtons = Array.from(lab.querySelectorAll("[data-source-view]"));
  const field = lab.querySelector("[data-sim-field]");
  const energy = lab.querySelector("[data-sim-energy]");
  const barrier = lab.querySelector("[data-sim-barrier]");
  const spin = lab.querySelector("[data-sim-spin]");
  const temp = lab.querySelector("[data-sim-temp]");
  const noise = lab.querySelector("[data-sim-noise]");
  const stability = lab.querySelector("[data-sim-stability]");
  const leakage = lab.querySelector("[data-sim-leakage]");
  const attack = lab.querySelector("[data-sim-attack]");
  const fill = lab.querySelector("[data-sim-fill]");
  const fieldLabel = lab.querySelector("[data-sim-field-label]");
  const energyLabel = lab.querySelector("[data-sim-energy-label]");
  const barrierLabel = lab.querySelector("[data-sim-barrier-label]");
  const spinControlLabel = lab.querySelector("[data-sim-spin-control-label]");
  const spinLabel = lab.querySelector("[data-sim-spin-label]");
  const tempLabel = lab.querySelector("[data-sim-temp-label]");
  const noiseLabel = lab.querySelector("[data-sim-noise-label]");
  const tunnelReadout = lab.querySelector("[data-sim-tunnel]");
  const tunnelLabel = lab.querySelector("[data-sim-tunnel-label]");
  const kappaReadout = lab.querySelector("[data-sim-kappa]");
  const raReadout = lab.querySelector("[data-sim-ra]");
  const raLabel = lab.querySelector("[data-sim-ra-label]");
  const thermalReadout = lab.querySelector("[data-sim-thermal]");
  const tmrReadout = lab.querySelector("[data-sim-tmr]");
  const tmrLabel = lab.querySelector("[data-sim-tmr-label]");
  const deltaReadout = lab.querySelector("[data-sim-delta]");
  const deltaLabel = lab.querySelector("[data-sim-delta-label]");
  const windowReadout = lab.querySelector("[data-sim-window]");
  const barrierVisual = lab.querySelector("[data-sim-barrier-visual]");
  const deviceVisual = lab.querySelector("[data-sim-device]");
  const deviceSource = lab.querySelector("[data-device-source]");
  const deviceDrain = lab.querySelector("[data-device-drain]");
  const modelTitle = lab.querySelector("[data-sim-model-title]");
  const modelSummary = lab.querySelector("[data-sim-model-summary]");
  const chartLabel = lab.querySelector("[data-sim-chart-label]");
  const chartTitle = lab.querySelector("[data-sim-chart-title]");
  const caption = lab.querySelector("[data-sim-caption]");
  const reflectionReadout = lab.querySelector("[data-sim-reflection]");
  const stateReadout = lab.querySelector("[data-sim-state]");
  const transmissionBar = lab.querySelector("[data-sim-transmission-bar]");
  const reflectionBar = lab.querySelector("[data-sim-reflection-bar]");
  const densityBar = lab.querySelector("[data-sim-density-bar]");
  const actualCellDevice = lab.querySelector("[data-actual-cell-device]");
  const actualCellTitle = lab.querySelector("[data-actual-cell-title]");
  const actualCellSummary = lab.querySelector("[data-actual-cell-summary]");
  const nativeModelTitle = lab.querySelector("[data-native-model-title]");
  const nativeModelCopy = lab.querySelector("[data-native-model-copy]");
  const nativeWaveTitle = lab.querySelector("[data-native-wave-title]");
  const nativeWaveCopy = lab.querySelector("[data-native-wave-copy]");
  const cellMathOneLabel = lab.querySelector("[data-cell-math-one-label]");
  const cellMathOne = lab.querySelector("[data-cell-math-one]");
  const cellMathOneNote = lab.querySelector("[data-cell-math-one-note]");
  const cellMathTwoLabel = lab.querySelector("[data-cell-math-two-label]");
  const cellMathTwo = lab.querySelector("[data-cell-math-two]");
  const cellMathTwoNote = lab.querySelector("[data-cell-math-two-note]");
  const cellMathThreeLabel = lab.querySelector("[data-cell-math-three-label]");
  const cellMathThree = lab.querySelector("[data-cell-math-three]");
  const cellMathThreeNote = lab.querySelector("[data-cell-math-three-note]");
  const graphRetention = lab.querySelector("[data-graph-retention]");
  const graphTransport = lab.querySelector("[data-graph-transport]");
  const graphRetentionTitle = lab.querySelector("[data-graph-retention-title]");
  const graphTransportTitle = lab.querySelector("[data-graph-transport-title]");
  const integratedSimCanvases = Array.from(lab.querySelectorAll("[data-integrated-sim]"));
  const exactGraphCanvases = Array.from(lab.querySelectorAll("[data-exact-graph]"));
  const orchestrationStatus = lab.querySelector("[data-orchestration-status]");
  const orchestrationDetail = lab.querySelector("[data-orchestration-detail]");
  const canvas = lab.querySelector("[data-wave-canvas]");
  const ctx = canvas?.getContext("2d");
  const sourceSimTag = lab.querySelector("[data-source-sim-tag]");
  const sourceSimTitle = lab.querySelector("[data-source-sim-title]");
  const sourceSimCopy = lab.querySelector("[data-source-sim-copy]");
  const sourceBitToggle = lab.querySelector("[data-sim-bit-toggle]");

  if (!canvas || !ctx) return;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const sigmoid = (value) => 1 / (1 + Math.exp(-value));
  const EV_TO_J = 1.60217662e-19;
  const HBAR = 1.0545718e-34;
  const ELECTRON_MASS = 9.10938356e-31;
  const SPINVAULT_EFFECTIVE_MASS = 3;
  const NAND_EFFECTIVE_MASS = 0.6;
  const UI_FONT = "Inter, system-ui, sans-serif";
  const MATH_FONT = '"Times New Roman", "STIX Two Math", "Cambria Math", Georgia, serif';
  const waveNumber = (energyEv, effectiveMass = 1) => 5.123 * Math.sqrt(Math.max(energyEv, 0.001) * Math.max(effectiveMass, 0.05));
  const kappaFromBarrier = (barrierEv, energyEv, effectiveMass = 1) => {
    const deltaEv = Math.max(barrierEv - energyEv, 0.001);
    const kappaPerMeter = Math.sqrt(2 * ELECTRON_MASS * effectiveMass * deltaEv * EV_TO_J) / HBAR;
    return kappaPerMeter * 1e-9;
  };
  const safeSinh = (value) => {
    if (value > 80) return Number.POSITIVE_INFINITY;
    return Math.sinh(value);
  };

  const finiteBarrierTransmission = (energyEv, barrierEv, widthNm, effectiveMass = 1) => {
    const e = Math.max(energyEv, 0.001);
    const v = Math.max(barrierEv, 0.001);
    if (Math.abs(e - v) < 0.002) {
      return 1 / (1 + (waveNumber(v, effectiveMass) * widthNm) ** 2 / 4);
    }
    if (e < v) {
      const kappa = kappaFromBarrier(v, e, effectiveMass);
      const sinhTerm = safeSinh(kappa * widthNm);
      if (!Number.isFinite(sinhTerm)) return 0;
      return 1 / (1 + ((v * v) * sinhTerm * sinhTerm) / (4 * e * (v - e)));
    }
    const k2 = waveNumber(e - v, effectiveMass);
    const sinTerm = Math.sin(k2 * widthNm);
    return 1 / (1 + ((v * v) * sinTerm * sinTerm) / (4 * e * (e - v)));
  };

  const wkbTransmission = (barrierEv, energyEv, widthNm, fieldEv = 0, effectiveMass = 1) => {
    const samples = 120;
    let integral = 0;
    const dx = widthNm / samples;
    for (let i = 0; i <= samples; i += 1) {
      const x = i * dx;
      const tiltedBarrier = barrierEv - fieldEv * (x / Math.max(widthNm, 0.001));
      const excess = tiltedBarrier - energyEv;
      if (excess > 0) integral += kappaFromBarrier(tiltedBarrier, energyEv, effectiveMass) * dx;
    }
    return Math.exp(-2 * integral);
  };

  const spinExchangeSplit = (spinPolarization, disturbance) => {
    const jExchangeEv = 0.08;
    const magnetizationProjection = clamp(0.45 + spinPolarization * 0.55 - disturbance * 0.16, 0.18, 1);
    return jExchangeEv * magnetizationProjection;
  };

  const spinResolvedBarrier = (barrierEv, spinPolarization, disturbance) => {
    const split = spinExchangeSplit(spinPolarization, disturbance);
    return {
      split,
      upBarrier: Math.max(0.01, barrierEv - split / 2),
      downBarrier: Math.max(0.01, barrierEv + split / 2)
    };
  };

  const modelMetrics = ({ mode, barrierHeightEv, electronEnergyEv, barrierNm, spinPolarization, temperatureK, disturbance }) => {
    const thermalEv = 8.617e-5 * temperatureK;
    const effectiveBarrierEv = Math.max(0.01, barrierHeightEv - electronEnergyEv);
    const mass = mode === "nand" ? NAND_EFFECTIVE_MASS : SPINVAULT_EFFECTIVE_MASS;
    const fieldAssistEv = mode === "nand" ? clamp(disturbance * 0.62 + (temperatureK - 300) * 0.0012, 0, 0.9) : clamp(disturbance * 0.14, 0, 0.2);
    const spinBarrier = spinResolvedBarrier(barrierHeightEv, spinPolarization, disturbance);
    const spinUpTransmission = finiteBarrierTransmission(electronEnergyEv, spinBarrier.upBarrier, barrierNm, SPINVAULT_EFFECTIVE_MASS);
    const spinDownTransmission = finiteBarrierTransmission(electronEnergyEv, spinBarrier.downBarrier, barrierNm, SPINVAULT_EFFECTIVE_MASS);
    const rawTransmission = mode === "nand"
      ? wkbTransmission(barrierHeightEv, electronEnergyEv, barrierNm, fieldAssistEv, NAND_EFFECTIVE_MASS)
      : Math.min(spinUpTransmission, spinDownTransmission);
    const tunnelProbability = clamp(rawTransmission, 1e-99, 1);
    const thermalAssist = Math.exp(-effectiveBarrierEv / Math.max(thermalEv, 0.001));
    const tmrRatio = (2 * spinPolarization * spinPolarization) / Math.max(0.02, 1 - spinPolarization * spinPolarization);
    const magneticControl = clamp(0.18 + spinPolarization * 0.62 + Math.log10(1 + tmrRatio) * 0.16, 0, 0.95);
    const thermalPressure = clamp((temperatureK - 240) / 180, 0, 1);
    const delta = effectiveBarrierEv / Math.max(thermalEv, 0.001);
    const logLeakSuppression = clamp(-Math.log10(tunnelProbability) / 45, 0, 1);
    const spinMismatch = clamp(Math.abs(spinUpTransmission - spinDownTransmission) / Math.max(spinUpTransmission + spinDownTransmission, 1e-99), 0, 1);
    const magneticLeakGate = mode === "spin" ? clamp(1 - magneticControl * 0.58 - spinMismatch * 0.18, 0.04, 1) : 1;
    const leakProbability = clamp((tunnelProbability + thermalAssist * 0.15 + disturbance * 0.08) * magneticLeakGate, 1e-99, 1);
    const attemptRateProxy = clamp(0.04 + thermalPressure * 0.2 + disturbance * 0.24 + electronEnergyEv / Math.max(barrierHeightEv, 0.1) * 0.08, 0.02, 0.72);
    const retentionProbability = clamp(Math.exp(-attemptRateProxy * Math.sqrt(leakProbability)), 0.02, 0.999999);
    const survivalAmplitude = Math.sqrt(retentionProbability);
    const thermalRetention = clamp(delta / 80, 0, 1);
    const nandProgramWindow = clamp((barrierHeightEv / 5) * 0.34 + (barrierNm / 5) * 0.24 + (1 - electronEnergyEv / Math.max(barrierHeightEv, 0.1)) * 0.2, 0, 1);
    const nandRetention = clamp(0.08 + retentionProbability * 0.4 + logLeakSuppression * 0.26 + nandProgramWindow * 0.18 - thermalPressure * 0.18 - disturbance * 0.24, 0.02, 0.98);
    const nandLeakagePressure = clamp((1 - logLeakSuppression) * 0.62 + thermalPressure * 0.22 + disturbance * 0.34, 0.02, 0.99);
    const spinLeakagePressure = clamp((1 - logLeakSuppression) * 0.5 + thermalAssist * 0.16 + thermalPressure * 0.2 + disturbance * 0.34 - magneticControl * 0.18, 0.01, 0.98);
    const spinRetentionMargin = clamp(0.1 + survivalAmplitude * 0.22 + thermalRetention * 0.26 + magneticControl * 0.3 + logLeakSuppression * 0.18 - thermalPressure * 0.16 - disturbance * 0.2, 0.02, 0.99);
    const leakagePressure = mode === "nand" ? nandLeakagePressure : spinLeakagePressure;
    const retentionMargin = mode === "nand" ? nandRetention : spinRetentionMargin;
    return {
      tunnelProbability,
      leakProbability,
      retentionProbability,
      survivalAmplitude,
      leakagePressure,
      retentionMargin,
      nandRetention,
      nandLeakagePressure,
      tmrRatio,
      delta,
      nandProgramWindow,
      effectiveMass: mass,
      fieldAssistEv,
      spinSplitEv: spinBarrier.split,
      spinUpBarrierEv: spinBarrier.upBarrier,
      spinDownBarrierEv: spinBarrier.downBarrier,
      spinUpTransmission: clamp(spinUpTransmission, 1e-99, 1),
      spinDownTransmission: clamp(spinDownTransmission, 1e-99, 1),
      kappaNm: kappaFromBarrier(barrierHeightEv, electronEnergyEv, mass)
    };
  };

  const graphState = {
    retentionProgress: 0,
    transportProgress: 0,
    retentionPointer: null,
    transportPointer: null,
    exactPointers: {}
  };

  const drawLineGraph = (graphCanvas, { title, xLabel, series, markers = [], progress = 1, pointer = null }) => {
    if (!graphCanvas) return;
    const graphCtx = graphCanvas.getContext("2d");
    const rect = graphCanvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * scale));
    const height = Math.max(1, Math.round(rect.height * scale));
    if (graphCanvas.width !== width || graphCanvas.height !== height) {
      graphCanvas.width = width;
      graphCanvas.height = height;
    }
    graphCtx.setTransform(scale, 0, 0, scale, 0, 0);
    const w = rect.width;
    const h = rect.height;
    const isLight = document.body.classList.contains("light");
    const ink = cssColor("--ink");
    const muted = cssColor("--muted");
    const line = cssColor("--line");
    const accent = cssColor("--accent");
    const accent2 = cssColor("--accent-2");
    const warning = cssColor("--warning");
    const danger = cssColor("--danger");
    const colors = [accent2, danger, accent, warning];
    const left = 60;
    const right = w - 26;
    const top = 74;
    const bottom = h - 60;
    const plotW = right - left;
    const plotH = bottom - top;

    graphCtx.clearRect(0, 0, w, h);
    graphCtx.fillStyle = isLight ? "rgba(255,255,255,0.96)" : "rgba(3,8,12,0.94)";
    graphCtx.fillRect(0, 0, w, h);
    graphCtx.save();
    graphCtx.fillStyle = isLight ? "rgba(0,95,134,0.08)" : "rgba(79,212,255,0.06)";
    graphCtx.beginPath();
    graphCtx.roundRect(16, 16, w - 32, h - 32, 16);
    graphCtx.fill();
    graphCtx.restore();

    graphCtx.save();
    graphCtx.fillStyle = isLight ? "rgba(255,255,255,0.96)" : "rgba(4,9,14,0.88)";
    graphCtx.beginPath();
    graphCtx.roundRect(left - 8, top - 18, plotW + 16, plotH + 36, 14);
    graphCtx.fill();
    graphCtx.restore();

    graphCtx.strokeStyle = line;
    graphCtx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = top + (plotH * i) / 4;
      graphCtx.beginPath();
      graphCtx.moveTo(left, y);
      graphCtx.lineTo(right, y);
      graphCtx.stroke();
    }
    for (let i = 0; i <= 5; i += 1) {
      const x = left + (plotW * i) / 5;
      graphCtx.beginPath();
      graphCtx.moveTo(x, top);
      graphCtx.lineTo(x, bottom);
      graphCtx.stroke();
    }
    graphCtx.fillStyle = ink;
    graphCtx.font = `900 15px ${UI_FONT}`;
    graphCtx.fillText(title, left, 28);
    graphCtx.fillStyle = muted;
    graphCtx.font = `800 11px ${UI_FONT}`;
    graphCtx.fillText(xLabel, left, h - 18);
    graphCtx.fillText("100%", 10, top + 4);
    graphCtx.fillText("0%", 18, bottom + 4);

    graphCtx.fillStyle = accent;
    graphCtx.font = `900 11px ${UI_FONT}`;
    graphCtx.fillText("interactive", right - 82, 28);

    const visibleProgress = clamp(progress, 0.02, 1);
    const pointerValues = [];
    series.forEach((item, seriesIndex) => {
      graphCtx.strokeStyle = colors[seriesIndex % colors.length];
      graphCtx.lineWidth = 4;
      graphCtx.shadowColor = colors[seriesIndex % colors.length];
      graphCtx.shadowBlur = isLight ? 0 : 8;
      graphCtx.beginPath();
      const visiblePoints = item.points.filter((point) => point.x <= visibleProgress);
      const pointsToDraw = visiblePoints.length ? visiblePoints : [item.points[0]];
      pointsToDraw.forEach((point, index) => {
        const x = left + point.x * plotW;
        const y = bottom - clamp(point.y, 0, 1) * plotH;
        if (index === 0) graphCtx.moveTo(x, y);
        else graphCtx.lineTo(x, y);
      });
      graphCtx.stroke();
      graphCtx.shadowBlur = 0;
      const last = pointsToDraw[pointsToDraw.length - 1];
      graphCtx.fillStyle = colors[seriesIndex % colors.length];
      graphCtx.font = `800 11px ${UI_FONT}`;
      const legendX = left + 8 + (seriesIndex % 2) * 170;
      const legendY = bottom + 28 + Math.floor(seriesIndex / 2) * 16;
      graphCtx.fillText(item.label, legendX, legendY);
      if (last) {
        graphCtx.beginPath();
        graphCtx.arc(left + last.x * plotW, bottom - clamp(last.y, 0, 1) * plotH, 5, 0, Math.PI * 2);
        graphCtx.fill();
      }
      if (pointer) {
        const nearest = item.points.reduce((best, point) => (
          Math.abs(point.x - pointer.x) < Math.abs(best.x - pointer.x) ? point : best
        ), item.points[0]);
        pointerValues.push({
          label: item.label,
          x: nearest.x,
          y: nearest.y,
          color: colors[seriesIndex % colors.length]
        });
      }
    });

    markers.forEach((marker) => {
      const x = left + clamp(marker.x, 0, 1) * plotW;
      graphCtx.strokeStyle = marker.color || accent;
      graphCtx.lineWidth = 2;
      graphCtx.setLineDash([6, 8]);
      graphCtx.beginPath();
      graphCtx.moveTo(x, top);
      graphCtx.lineTo(x, bottom);
      graphCtx.stroke();
      graphCtx.setLineDash([]);
      graphCtx.fillStyle = marker.color || accent;
      graphCtx.font = `900 11px ${UI_FONT}`;
      const markerLabelW = Math.min(150, graphCtx.measureText(marker.label).width + 18);
      const markerLabelX = Math.min(Math.max(left + 4, x - markerLabelW / 2), right - markerLabelW - 4);
      const markerLabelY = top + 12 + (markers.indexOf(marker) % 2) * 18;
      graphCtx.fillStyle = document.body.classList.contains("light") ? "rgba(255,255,255,0.96)" : "rgba(5,8,12,0.92)";
      drawRoundedRect(graphCtx, markerLabelX, markerLabelY - 12, markerLabelW, 20, 7);
      graphCtx.fillStyle = marker.color || accent;
      graphCtx.fillText(marker.label, markerLabelX + 8, markerLabelY + 2);
    });

    if (pointer) {
      const x = left + clamp(pointer.x, 0, 1) * plotW;
      graphCtx.strokeStyle = ink;
      graphCtx.setLineDash([3, 6]);
      graphCtx.lineWidth = 1.5;
      graphCtx.beginPath();
      graphCtx.moveTo(x, top);
      graphCtx.lineTo(x, bottom);
      graphCtx.stroke();
      graphCtx.setLineDash([]);
      pointerValues.forEach((value) => {
        const pointX = left + clamp(value.x, 0, 1) * plotW;
        const pointY = bottom - clamp(value.y, 0, 1) * plotH;
        graphCtx.fillStyle = value.color;
        graphCtx.beginPath();
        graphCtx.arc(pointX, pointY, 5, 0, Math.PI * 2);
        graphCtx.fill();
        graphCtx.strokeStyle = isLight ? "rgba(255,255,255,0.92)" : "rgba(3,8,12,0.95)";
        graphCtx.lineWidth = 2;
        graphCtx.stroke();
      });
      const boxW = Math.min(260, Math.max(196, w * 0.32));
      const boxH = 42 + pointerValues.length * 24;
      const anchorY = pointerValues.length
        ? bottom - clamp(pointerValues[0].y, 0, 1) * plotH
        : top + plotH * 0.5;
      const boxX = Math.min(Math.max(left + 12, x + 16), right - boxW);
      const boxY = Math.min(Math.max(top + 12, anchorY - boxH / 2), bottom - boxH - 10);
      graphCtx.fillStyle = document.body.classList.contains("light") ? "rgba(255,255,255,0.96)" : "rgba(5,8,12,0.92)";
      graphCtx.strokeStyle = line;
      graphCtx.lineWidth = 1.2;
      drawRoundedRect(graphCtx, boxX, boxY, boxW, boxH, 12);
      graphCtx.fillStyle = ink;
      graphCtx.font = `900 12px ${UI_FONT}`;
      graphCtx.fillText(pointer.label, boxX + 12, boxY + 20);
      pointerValues.forEach((value, index) => {
        const rowY = boxY + 44 + index * 24;
        graphCtx.fillStyle = value.color;
        graphCtx.font = `800 12px ${UI_FONT}`;
        graphCtx.fillText("●", boxX + 12, rowY);
        graphCtx.fillStyle = ink;
        graphCtx.fillText(`${value.label}: x=${Math.round(value.x * 100)}%, y=${Math.round(clamp(value.y, 0, 1) * 100)}%`, boxX + 28, rowY);
      });
    }
  };

  let lastGraphParams = null;
  const drawSimulationGraphs = ({ mode, barrierHeightEv, electronEnergyEv, barrierNm, spinPolarization, temperatureK, disturbance }) => {
    lastGraphParams = { mode, barrierHeightEv, electronEnergyEv, barrierNm, spinPolarization, temperatureK, disturbance };
    if (graphRetentionTitle) graphRetentionTitle.textContent = mode === "nand" ? "Retention vs disturbance" : "MTJ margin vs disturbance";
    if (graphTransportTitle) graphTransportTitle.textContent = mode === "nand" ? "Oxide width sweep" : "Barrier width sweep";
    const disturbancePoints = Array.from({ length: 36 }, (_, index) => {
      const d = index / 35;
      const metrics = modelMetrics({ mode, barrierHeightEv, electronEnergyEv, barrierNm, spinPolarization, temperatureK, disturbance: d });
      return { x: d, retention: metrics.retentionMargin, leakage: metrics.leakagePressure };
    });
    const widthPoints = Array.from({ length: 42 }, (_, index) => {
      const dNm = 0.8 + (4.2 * index) / 41;
      const metrics = modelMetrics({ mode, barrierHeightEv, electronEnergyEv, barrierNm: dNm, spinPolarization, temperatureK, disturbance });
      const transmissionScore = clamp(-Math.log10(metrics.tunnelProbability) / 45, 0, 1);
      return { x: (dNm - 0.8) / 4.2, transmissionScore, retention: metrics.retentionMargin, leakage: metrics.leakagePressure };
    });
    drawLineGraph(graphRetention, {
      title: mode === "nand" ? "NAND market retention and leakage" : "SpinVault margin and leakage",
      xLabel: "process / attack disturbance sweep",
      series: [
        { label: mode === "nand" ? "charge retention" : "magnetic margin", points: disturbancePoints.map((p) => ({ x: p.x, y: p.retention })) },
        { label: "leakage pressure", points: disturbancePoints.map((p) => ({ x: p.x, y: p.leakage })) }
      ],
      markers: [{ x: disturbance, label: "current", color: cssColor("--accent") }],
      progress: graphState.retentionProgress,
      pointer: graphState.retentionPointer
    });
    drawLineGraph(graphTransport, {
      title: mode === "nand" ? "NAND oxide thickness changes leak exponentially" : "SpinVault barrier width changes tunneling exponentially",
      xLabel: "barrier width d: 0.8 nm → 5.0 nm",
      series: [
        { label: "leak suppression", points: widthPoints.map((p) => ({ x: p.x, y: p.transmissionScore })) },
        { label: mode === "nand" ? "retention" : "margin", points: widthPoints.map((p) => ({ x: p.x, y: p.retention })) },
        { label: "leakage", points: widthPoints.map((p) => ({ x: p.x, y: p.leakage })) }
      ],
      markers: [{ x: (barrierNm - 0.8) / 4.2, label: `${barrierNm.toFixed(1)} nm`, color: cssColor("--warning") }],
      progress: graphState.transportProgress,
      pointer: graphState.transportPointer
    });
  };

  let lastIntegratedSimParams = null;
  let lastWaveParams = null;
  const drawIntegratedSimulations = ({ barrierHeightEv, electronEnergyEv, barrierNm, spinPolarization, temperatureK, disturbance, now = performance.now() }) => {
    if (!integratedSimCanvases.length && !canvas) return;
    const isLight = document.body.classList.contains("light");
    const palette = isLight
      ? { bg: "#ffffff", grid: "rgba(18,20,23,0.08)", panel: "rgba(0,95,134,0.09)", ink: "rgba(18,20,23,0.92)", spin: "rgba(8,96,41,1)", spinDown: "rgba(0,95,134,1)", nand: "rgba(156,18,55,1)", charge: "rgba(143,79,0,1)", energy: "rgba(143,79,0,0.9)", barrier: "rgba(156,18,55,0.78)" }
      : { bg: "#03080c", grid: "rgba(255,255,255,0.08)", panel: "rgba(79,212,255,0.12)", ink: "rgba(243,246,251,0.92)", spin: "rgba(137,255,154,1)", spinDown: "rgba(79,212,255,1)", nand: "rgba(255,107,141,1)", charge: "rgba(255,212,102,1)", energy: "rgba(255,212,102,0.95)", barrier: "rgba(255,107,141,0.86)" };
    const spinMetrics = modelMetrics({ mode: "spin", barrierHeightEv, electronEnergyEv, barrierNm, spinPolarization, temperatureK, disturbance });
    const nandMetrics = modelMetrics({ mode: "nand", barrierHeightEv, electronEnergyEv, barrierNm, spinPolarization, temperatureK, disturbance });
    const phase = now / 520;

    const fitCanvas = (canvas) => {
      if (!canvas) return null;
      const context = canvas.getContext("2d");
      if (!context) return null;
      const rect = canvas.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(rect.width * scale));
      const height = Math.max(1, Math.round(rect.height * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.setTransform(scale, 0, 0, scale, 0, 0);
      return { context, width: rect.width, height: rect.height };
    };
    const drawBackground = (context, width, height) => {
      context.clearRect(0, 0, width, height);
      context.fillStyle = palette.bg;
      context.fillRect(0, 0, width, height);
      context.strokeStyle = palette.grid;
      context.lineWidth = 1;
      for (let x = 0; x <= width; x += 36) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
      }
      for (let y = 0; y <= height; y += 36) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();
      }
    };
    const exactTransportSummary = (kind, metrics) => {
      const probability = kind === "spin"
        ? Math.max(metrics.spinUpTransmission, metrics.spinDownTransmission)
        : metrics.leakProbability;
      const particleBase = 180;
      const transmitted = Math.round(clamp(Math.sqrt(probability) * particleBase * (kind === "spin" ? 1.4 : 0.55), 0, particleBase));
      const reflected = Math.max(0, particleBase - transmitted);
      const effectiveEnergy = kind === "spin"
        ? electronEnergyEv + metrics.spinSplitEv / 2
        : electronEnergyEv + metrics.fieldAssistEv;
      return {
        probability: clamp(probability, 1e-99, 1),
        transmitted,
        reflected,
        effectiveEnergy,
        retention: kind === "spin" ? metrics.retentionMargin : metrics.nandRetention,
        leak: kind === "spin" ? metrics.leakagePressure : metrics.nandLeakagePressure
      };
    };
    const drawSummaryPanel = (context, x, y, w, h, kind, metrics) => {
      const summary = exactTransportSummary(kind, metrics);
      context.save();
      context.fillStyle = isLight ? "rgba(255,255,255,0.94)" : "rgba(3,8,12,0.88)";
      context.strokeStyle = isLight ? "rgba(18,20,23,0.16)" : "rgba(255,255,255,0.13)";
      context.lineWidth = 1;
      context.beginPath();
      context.roundRect(x, y, w, h, 12);
      context.fill();
      context.stroke();
      context.fillStyle = palette.ink;
      context.font = "800 12px Inter, system-ui, sans-serif";
      context.fillText("Transmission summary", x + 12, y + 22);
      context.fillStyle = isLight ? "rgba(57,60,66,0.88)" : "rgba(215,222,232,0.86)";
      context.font = `700 9.5px ${UI_FONT}`;
      const rows = [
        `V0 ${barrierHeightEv.toFixed(2)} eV`,
        `d ${barrierNm.toFixed(2)} nm`,
        `Ebase ${electronEnergyEv.toFixed(3)} eV`,
        `Eeff ${summary.effectiveEnergy.toFixed(3)} eV`,
        `T ${summary.probability.toExponential(2)}`
      ];
      rows.forEach((row, index) => context.fillText(row, x + 12, y + 43 + index * 13));
      const chartX = x + w - 50;
      const chartY = y + 46;
      const chartW = 36;
      const chartH = h - 86;
      context.strokeStyle = isLight ? "rgba(18,20,23,0.18)" : "rgba(255,255,255,0.16)";
      context.beginPath();
      context.moveTo(chartX, chartY + chartH);
      context.lineTo(chartX + chartW, chartY + chartH);
      context.stroke();
      const maxCount = Math.max(1, summary.transmitted, summary.reflected);
      const barW = 10;
      const transmittedH = chartH * (summary.transmitted / maxCount);
      const reflectedH = chartH * (summary.reflected / maxCount);
      context.fillStyle = palette.spinDown;
      context.fillRect(chartX + 4, chartY + chartH - transmittedH, barW, transmittedH);
      context.fillStyle = kind === "spin" ? palette.spin : palette.nand;
      context.fillRect(chartX + 22, chartY + chartH - reflectedH, barW, reflectedH);
      context.font = "800 8px Inter, system-ui, sans-serif";
      context.fillStyle = palette.ink;
      context.fillText("T", chartX + 5, chartY + chartH + 12);
      context.fillText("R", chartX + 23, chartY + chartH + 12);
      context.fillStyle = kind === "spin" ? palette.spin : palette.charge;
      context.font = `800 11px ${UI_FONT}`;
      context.fillText(`ret ${Math.round(summary.retention * 100)}%`, x + 12, y + h - 16);
      context.fillStyle = kind === "spin" ? palette.spinDown : palette.nand;
      context.textAlign = "right";
      context.fillText(`leak ${Math.round(summary.leak * 100)}%`, x + w - 12, y + h - 16);
      context.restore();
    };
    const drawMetricStrip = (context, x, y, w, kind, metrics) => {
      const summary = exactTransportSummary(kind, metrics);
      const pill = (text, px, py, color, align = "left") => {
        context.save();
        context.font = `800 11px ${UI_FONT}`;
        const textW = context.measureText(text).width;
        const boxW = textW + 22;
        const boxX = align === "right" ? px - boxW : px;
        context.fillStyle = isLight ? "rgba(255,255,255,0.94)" : "rgba(3,8,12,0.88)";
        context.strokeStyle = isLight ? "rgba(18,20,23,0.18)" : "rgba(255,255,255,0.16)";
        context.lineWidth = 1;
        context.beginPath();
        context.roundRect(boxX, py, boxW, 30, 12);
        context.fill();
        context.stroke();
        context.fillStyle = color;
        context.fillText(text, boxX + 11, py + 20);
        context.restore();
        return boxW;
      };
      const items = kind === "spin"
        ? [
          { label: `ret ${Math.round(summary.retention * 100)}%`, color: palette.spin },
          { label: `leak ${Math.round(summary.leak * 100)}%`, color: palette.spinDown }
        ]
        : [
          { label: `stored ${Math.round(metrics.nandRetention * 100)}%`, color: palette.charge },
          { label: `leak ${Math.round(metrics.nandLeakagePressure * 100)}%`, color: palette.nand }
        ];
      context.save();
      context.font = `800 11px ${UI_FONT}`;
      const leftW = Math.max(90, context.measureText(items[0].label).width + 22);
      const rightW = Math.max(90, context.measureText(items[1].label).width + 22);
      context.restore();
      const rightX = x + w;
      const minGap = 18;
      const leftEnd = x + leftW;
      const rightStart = rightX - rightW;
      if (rightStart - leftEnd < minGap) {
        pill(items[0].label, x, y - 2, items[0].color);
        pill(items[1].label, x, y + 32, items[1].color);
      } else {
        pill(items[0].label, x, y + 6, items[0].color);
        pill(items[1].label, rightX, y + 6, items[1].color, "right");
      }
    };
    const label = (context, text, x, y, color = palette.ink) => {
      context.font = `800 10px ${UI_FONT}`;
      context.fillStyle = isLight ? "rgba(255,255,255,0.94)" : "rgba(3,8,12,0.86)";
      const metrics = context.measureText(text);
      const boxWidth = Math.min(metrics.width + 16, context.canvas.getBoundingClientRect().width - 28);
      const boxX = clamp(x, 14, context.canvas.getBoundingClientRect().width - boxWidth - 14);
      const boxY = clamp(y - 15, 14, context.canvas.getBoundingClientRect().height - 30);
      context.beginPath();
      context.roundRect(boxX, boxY, boxWidth, 24, 8);
      context.fill();
      context.strokeStyle = isLight ? "rgba(18,20,23,0.13)" : "rgba(255,255,255,0.14)";
      context.stroke();
      context.fillStyle = color;
      context.fillText(text, boxX + 8, boxY + 16);
    };
    const smallCaption = (context, text, x, y, color = palette.ink) => {
      context.save();
      context.font = `800 9.5px ${UI_FONT}`;
      context.fillStyle = color;
      context.fillText(text, x, y);
      context.restore();
    };
    const legendPill = (context, text, x, y, width, color = palette.ink) => {
      context.save();
      context.fillStyle = isLight ? "rgba(255,255,255,0.94)" : "rgba(3,8,12,0.9)";
      context.strokeStyle = isLight ? "rgba(18,20,23,0.16)" : "rgba(255,255,255,0.14)";
      context.lineWidth = 1;
      context.beginPath();
      context.roundRect(x, y, width, 28, 999);
      context.fill();
      context.stroke();
      context.fillStyle = color;
      context.font = `800 10px ${UI_FONT}`;
      context.textAlign = "center";
      context.fillText(text, x + width / 2, y + 18);
      context.restore();
    };
    const drawWavePanel = (canvas, kind) => {
      const fitted = fitCanvas(canvas);
      if (!fitted) return;
      const { context, width, height } = fitted;
      const metrics = kind === "spin" ? spinMetrics : nandMetrics;
      const spinBarrier = spinResolvedBarrier(barrierHeightEv, spinPolarization, disturbance);
      drawBackground(context, width, height);
      const left = 34;
      const right = width - 34;
      const center = width * 0.52;
      const barrierW = clamp(40 + barrierNm * 8, 54, 122);
      const bx = center - barrierW / 2;
      const by = height * 0.2;
      const bh = height * 0.58;
      const base = height * 0.56;
      context.fillStyle = palette.panel;
      context.fillRect(left, height * 0.17, bx - left, height * 0.62);
      context.fillRect(bx + barrierW, height * 0.17, right - bx - barrierW, height * 0.62);
      context.fillStyle = "rgba(255,107,141,0.22)";
      context.strokeStyle = palette.barrier;
      context.lineWidth = 3;
      context.beginPath();
      context.roundRect(bx, by, barrierW, bh, 10);
      context.fill();
      context.stroke();
      const energyY = height * (0.77 - clamp(electronEnergyEv / Math.max(barrierHeightEv, 0.1), 0.05, 1.25) * 0.42);
      context.setLineDash([9, 9]);
      context.strokeStyle = palette.energy;
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(left, energyY);
      context.lineTo(right, energyY);
      context.stroke();
      context.setLineDash([]);
      const trace = (stroke, offset = 0, amplitudeScale = 1, dashed = false) => {
        context.save();
        context.strokeStyle = stroke;
        context.lineWidth = dashed ? 3 : 5;
        context.setLineDash(dashed ? [9, 12] : []);
        context.beginPath();
        const barrierHeight = kind === "spin" ? spinBarrier.upBarrier : barrierHeightEv;
        const kappa = kind === "spin"
          ? kappaFromBarrier(barrierHeight, electronEnergyEv, SPINVAULT_EFFECTIVE_MASS)
          : kappaFromBarrier(barrierHeightEv, electronEnergyEv, NAND_EFFECTIVE_MASS);
        for (let x = left; x <= right; x += 3) {
          let amp = 38 * amplitudeScale;
          if (kind === "spin") {
            if (x > bx && x < bx + barrierW) {
              const progress = (x - bx) / Math.max(1, barrierW);
              amp *= Math.exp(-kappa * barrierNm * progress / 1.45);
            }
            if (x >= bx + barrierW) amp *= Math.sqrt(Math.max(metrics.spinUpTransmission, 1e-99)) * 18;
          } else {
            const d = Math.abs(x - center) / Math.max(1, barrierW * 1.5);
            amp *= Math.exp(-d * 2.2) * clamp(metrics.nandRetention + 0.18, 0.1, 1);
            if (x > bx && x < bx + barrierW) amp *= Math.sqrt(metrics.leakProbability) * 18;
          }
          const k = 0.082;
          const y = base + Math.sin(x * k - phase + offset) * amp;
          if (x === left) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
        context.restore();
      };
      if (kind === "spin") {
        trace(palette.spin, 0, 1, false);
        trace(palette.spinDown, Math.PI / 2, 0.72, true);
        label(context, `T↑=${metrics.spinUpTransmission.toExponential(1)}`, left + 10, 34, palette.spin);
        label(context, `T↓=${metrics.spinDownTransmission.toExponential(1)}`, left + 10, 66, palette.spinDown);
        smallCaption(context, "Al2O3 MTJ barrier", clamp(bx - 20, left + 8, right - 130), by - 10, palette.barrier);
      } else {
        trace(palette.charge, 0, 1, false);
        trace(palette.nand, Math.PI / 2, 0.72, true);
        label(context, `Tleak=${metrics.leakProbability.toExponential(1)}`, left + 10, 32, palette.nand);
        label(context, `Pret=${Math.round(metrics.retentionProbability * 100)}%`, left + 10, 64, palette.charge);
        const legendY = height - 102;
        const legendW = (right - left - 24) / 2;
        legendPill(context, "charge trap region", left + 6, legendY, legendW, palette.charge);
        legendPill(context, "tunnel oxide barrier", left + 18 + legendW, legendY, legendW, palette.barrier);
        smallCaption(context, "stored charge", left + 10, height - 66, palette.charge);
        smallCaption(context, "leakage path", right - 140, height - 66, palette.nand);
      }
      const waveY = height * 0.49;
      drawMetricStrip(context, left + 14, height - 58, right - left - 28, kind, metrics);
    };
    const drawParticlePanel = (canvas, kind) => {
      const fitted = fitCanvas(canvas);
      if (!fitted) return;
      const { context, width, height } = fitted;
      const metrics = kind === "spin" ? spinMetrics : nandMetrics;
      drawBackground(context, width, height);
      const left = 34;
      const right = width - 34;
      const center = width * 0.52;
      const barrierW = 58;
      const bx = center - barrierW / 2;
      const by = height * 0.2;
      const bh = height * 0.6;
      const readoutY = height - 43;
      const sideGap = 16;
      const sideW = Math.max(180, ((right - left) - barrierW - sideGap * 2) / 2);
      const leftBoxX = left;
      const rightBoxX = bx + barrierW + sideGap;
      const leftBoxY = height * 0.22;
      const rightBoxY = leftBoxY;
      const boxH = height * 0.48;
      context.fillStyle = palette.panel;
      context.fillRect(leftBoxX, leftBoxY, sideW, boxH);
      context.fillRect(rightBoxX, rightBoxY, sideW, boxH);
      smallCaption(context, "FM1 pinned", leftBoxX + 14, height * 0.2, kind === "spin" ? palette.spinDown : palette.charge);
      smallCaption(context, "FM2 free", rightBoxX + 16, height * 0.2, kind === "spin" ? palette.spinDown : palette.nand);
      context.fillStyle = "rgba(255,107,141,0.22)";
      context.strokeStyle = palette.barrier;
      context.lineWidth = 3;
      context.beginPath();
      context.roundRect(bx, by, barrierW, bh, 10);
      context.fill();
      context.stroke();

      const particleCount = 40;
      const leakFactor = kind === "spin"
        ? clamp(Math.sqrt(metrics.tunnelProbability) * 4, 0.04, 0.72)
        : clamp(metrics.nandLeakagePressure * 0.84 + (1 - metrics.nandRetention) * 0.34, 0.06, 0.94);
      const waveColorLeft = kind === "spin" ? palette.spin : palette.charge;
      const waveColorRight = kind === "spin" ? palette.spinDown : palette.nand;

      const leftSpan = Math.max(1, sideW - 40);
      const rightSpan = Math.max(1, sideW - 40);
      const particleRows = 4;
      const particleCols = 10;
      const gridLeft = leftBoxX + 22;
      const gridRight = rightBoxX + 22;
      const gridTop = leftBoxY + 66;
      const gridHeight = boxH - 88;
      const rowStep = gridHeight / Math.max(1, particleRows - 1);
      const colStepLeft = leftSpan / Math.max(1, particleCols - 1);
      const colStepRight = rightSpan / Math.max(1, particleCols - 1);
      for (let i = 0; i < particleCount; i += 1) {
        const seed = i * 997.3;
        const passes = i / particleCount < leakFactor;
        const col = i % particleCols;
        const row = Math.floor(i / particleCols);
        const leftX = gridLeft + col * colStepLeft + (row % 2) * 3;
        const leftY = gridTop + row * rowStep + ((col % 2) * 3 - 1.5);
        const leftAlpha = kind === "spin" ? 0.84 : 0.9;

        context.globalAlpha = leftAlpha;
        context.fillStyle = waveColorLeft;
        context.beginPath();
        context.arc(leftX, leftY, kind === "spin" ? 5.2 : 5.4, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = 1;

        if (passes) {
          const rightRow = row % particleRows;
          const rightCol = col % particleCols;
          const rightX = gridRight + rightCol * colStepRight + (rightRow % 2) * 3;
          const rightY = gridTop + rightRow * rowStep + ((rightCol % 2) * 3 - 1.5);
          context.globalAlpha = kind === "spin" ? 0.95 : 0.84;
          context.fillStyle = waveColorRight;
          context.beginPath();
          context.arc(rightX, rightY, kind === "spin" ? 5.2 : 5.4, 0, Math.PI * 2);
          context.fill();
          context.globalAlpha = 1;
        }
      }

      if (kind === "spin") {
        label(context, `retention=${Math.round(metrics.retentionMargin * 100)}%`, left + 10, readoutY, kind === "spin" ? palette.spin : palette.charge);
        label(context, `TMR=${Math.round(metrics.tmrRatio * 100)}%`, right - 146, readoutY, kind === "spin" ? palette.spinDown : palette.nand);
      } else {
        label(context, `stored=${Math.round(metrics.nandRetention * 100)}%`, left + 10, readoutY, palette.charge);
        label(context, `leak=${Math.round(metrics.nandLeakagePressure * 100)}%`, right - 146, readoutY, palette.nand);
      }
    };
    integratedSimCanvases.forEach((canvas) => {
      const type = canvas.dataset.integratedSim;
      if (type === "spin-wave") drawWavePanel(canvas, "spin");
      if (type === "nand-wave") drawWavePanel(canvas, "nand");
      if (type === "spin-particle") drawParticlePanel(canvas, "spin");
      if (type === "nand-particle") drawParticlePanel(canvas, "nand");
    });

    const sourceMode = simMode;
    if (canvas) {
      if (simView === "wave") drawWavePanel(canvas, sourceMode);
      if (simView === "particle") drawParticlePanel(canvas, sourceMode);
    }
  };

  const drawExactTheoryGraphs = ({ barrierHeightEv, electronEnergyEv, barrierNm, spinPolarization, temperatureK, disturbance }) => {
    if (!exactGraphCanvases.length) return;
    const spinBarrier = spinResolvedBarrier(barrierHeightEv, spinPolarization, disturbance);
    const nandField = clamp(disturbance * 0.62 + (temperatureK - 300) * 0.0012, 0, 0.9);
    const spinMetrics = modelMetrics({ mode: "spin", barrierHeightEv, electronEnergyEv, barrierNm, spinPolarization, temperatureK, disturbance });
    const nandMetrics = modelMetrics({ mode: "nand", barrierHeightEv, electronEnergyEv, barrierNm, spinPolarization, temperatureK, disturbance });

    const normalizedLog = (value) => clamp((Math.log10(Math.max(value, 1e-99)) + 99) / 99, 0, 1);
    const energyMax = Math.max(5, barrierHeightEv + 1.2);
    const energyPoints = Array.from({ length: 90 }, (_, index) => 0.05 + (energyMax - 0.05) * index / 89);
    const spinUp = energyPoints.map((e) => ({ x: e / energyMax, y: normalizedLog(finiteBarrierTransmission(e, spinBarrier.upBarrier, barrierNm, SPINVAULT_EFFECTIVE_MASS)) }));
    const spinDown = energyPoints.map((e) => ({ x: e / energyMax, y: normalizedLog(finiteBarrierTransmission(e, spinBarrier.downBarrier, barrierNm, SPINVAULT_EFFECTIVE_MASS)) }));
    const nandLeak = energyPoints.map((e) => ({ x: e / energyMax, y: normalizedLog(wkbTransmission(barrierHeightEv, e, barrierNm, nandField, NAND_EFFECTIVE_MASS)) }));
    const widthPoints = Array.from({ length: 90 }, (_, index) => 0.8 + 4.2 * index / 89);
    const nandRetention = widthPoints.map((dNm) => {
      const metrics = modelMetrics({ mode: "nand", barrierHeightEv, electronEnergyEv, barrierNm: dNm, spinPolarization, temperatureK, disturbance });
      return { x: (dNm - 0.8) / 4.2, y: metrics.nandRetention };
    });
    const nandLeakByWidth = widthPoints.map((dNm) => {
      const metrics = modelMetrics({ mode: "nand", barrierHeightEv, electronEnergyEv, barrierNm: dNm, spinPolarization, temperatureK, disturbance });
      return { x: (dNm - 0.8) / 4.2, y: 1 - metrics.nandLeakagePressure };
    });
    const densityPoints = (barrierEv, mass, spinOffset = 0) => Array.from({ length: 120 }, (_, index) => {
      const xNorm = index / 119;
      const xNm = -barrierNm * 1.6 + xNorm * barrierNm * 3.2;
      let amp;
      if (xNm < 0) {
        amp = 0.45 + 0.42 * Math.sin((xNm + barrierNm * 1.6) * waveNumber(electronEnergyEv, mass) * 0.9 + spinOffset) ** 2;
      } else if (xNm <= barrierNm) {
        amp = Math.exp(-2 * kappaFromBarrier(barrierEv, electronEnergyEv, mass) * xNm);
      } else {
        const t = finiteBarrierTransmission(electronEnergyEv, barrierEv, barrierNm, mass);
        amp = Math.max(0.02, t * 12) * (0.55 + 0.24 * Math.sin(xNm * 2.2 + spinOffset) ** 2);
      }
      return { x: xNorm, y: clamp(amp, 0, 1) };
    });
    const nandDensity = densityPoints(barrierHeightEv, NAND_EFFECTIVE_MASS, Math.PI / 4).map((point) => ({ ...point, y: point.y * clamp(nandMetrics.nandRetention + 0.16, 0.1, 1) }));

    exactGraphCanvases.forEach((canvas) => {
      const graphType = canvas.dataset.exactGraph;
      if (graphType === "spin-transmission") {
        drawLineGraph(canvas, {
          title: "Transmission probability vs electron energy",
          xLabel: `E: 0.05 eV → ${energyMax.toFixed(1)} eV`,
          series: [
            { label: "spin-up channel", points: spinUp },
            { label: "spin-down channel", points: spinDown }
          ],
          markers: [
            { x: electronEnergyEv / energyMax, label: `E=${electronEnergyEv.toFixed(2)} eV`, color: cssColor("--warning") },
            { x: spinBarrier.upBarrier / energyMax, label: "Veff↑", color: cssColor("--accent-2") },
            { x: spinBarrier.downBarrier / energyMax, label: "Veff↓", color: cssColor("--accent") }
          ],
          progress: 1,
          pointer: graphState.exactPointers[graphType] || null
        });
      }
      if (graphType === "spin-density") {
        drawLineGraph(canvas, {
          title: "Electron wavefunction probability density",
          xLabel: "position across FM1 / barrier / FM2",
          series: [
            { label: "|ψ↑|² density", points: densityPoints(spinBarrier.upBarrier, SPINVAULT_EFFECTIVE_MASS, 0) },
            { label: "|ψ↓|² density", points: densityPoints(spinBarrier.downBarrier, SPINVAULT_EFFECTIVE_MASS, Math.PI / 2) }
          ],
          markers: [
            { x: 0.5, label: `d=${barrierNm.toFixed(1)} nm`, color: cssColor("--danger") }
          ],
          progress: 1,
          pointer: graphState.exactPointers[graphType] || null
        });
      }
      if (graphType === "nand-transmission") {
        drawLineGraph(canvas, {
          title: "WKB leak probability vs electron energy",
          xLabel: `E: 0.05 eV → ${energyMax.toFixed(1)} eV`,
          series: [
            { label: "oxide leak probability", points: nandLeak }
          ],
          markers: [
            { x: electronEnergyEv / energyMax, label: `E=${electronEnergyEv.toFixed(2)} eV`, color: cssColor("--warning") },
            { x: barrierHeightEv / energyMax, label: "oxide barrier", color: cssColor("--danger") }
          ],
          progress: 1,
          pointer: graphState.exactPointers[graphType] || null
        });
      }
      if (graphType === "nand-retention") {
        drawLineGraph(canvas, {
          title: "Charge retention and leakage vs oxide width",
          xLabel: "t_ox: 0.8 nm → 5.0 nm",
          series: [
            { label: "charge retention", points: nandRetention },
            { label: "leak suppression", points: nandLeakByWidth },
            { label: "|ψ|² density proxy", points: nandDensity }
          ],
          markers: [
            { x: (barrierNm - 0.8) / 4.2, label: `${barrierNm.toFixed(1)} nm`, color: cssColor("--warning") }
          ],
          progress: 1,
          pointer: graphState.exactPointers[graphType] || null
        });
      }
    });
  };

  let orchestrationTimer = null;
  const sendOrchestrationSnapshot = (payload) => {
    if (!orchestrationStatus || !orchestrationDetail) return;
    window.clearTimeout(orchestrationTimer);
    orchestrationTimer = window.setTimeout(async () => {
      try {
        const response = await fetch("http://127.0.0.1:8000/api/predict", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        orchestrationStatus.textContent = "Connected to local orchestrator";
        orchestrationDetail.innerHTML = `Run <code>${data.run_id}</code> · ${data.design_window} · leakage ${Math.round(data.leakage_pressure * 100)}%`;
      } catch (error) {
        orchestrationStatus.textContent = "Local API not connected";
        orchestrationDetail.innerHTML = "Browser simulator is running locally. Start <code>orchestration/</code> to enable metadata logging and validation jobs.";
      }
    }, 450);
  };

  const drawWave = ({
    now = performance.now(),
    mode,
    barrierHeightEv,
    electronEnergyEv,
    barrierNm,
    transmission,
    leakProbability,
    retentionProbability,
    survivalAmplitude,
    retentionMargin,
    nandRetention,
    nandError,
    effectiveMass = 1,
    spinSplitEv = 0,
    spinUpBarrierEv = barrierHeightEv,
    spinDownBarrierEv = barrierHeightEv,
    spinUpTransmission = transmission,
    spinDownTransmission = transmission,
    kappaNm = kappaFromBarrier(barrierHeightEv, electronEnergyEv, effectiveMass)
  }) => {
    if (!ctx || !canvas) return;
    const isLight = document.body.classList.contains("light");
    const motionPhase = now / 540;
    const colors = isLight
      ? {
          bg: "#ffffff",
          axis: "rgba(18, 20, 23, 0.58)",
          barrierFill: "rgba(179, 25, 66, 0.28)",
          barrierStroke: "rgba(156, 18, 55, 1)",
          energy: "rgba(143, 79, 0, 0.95)",
          wave: "rgba(8, 96, 41, 1)",
          density: "rgba(0, 95, 134, 0.34)",
          text: "rgba(18, 20, 23, 0.92)",
          region: "rgba(0, 95, 134, 0.14)",
          magnet: "rgba(8, 96, 41, 1)"
        }
      : {
          bg: "#050b10",
          axis: "rgba(243, 246, 251, 0.42)",
          barrierFill: "rgba(255, 111, 143, 0.24)",
          barrierStroke: "rgba(255, 111, 143, 0.9)",
          energy: "rgba(255, 209, 102, 0.95)",
          wave: "rgba(137, 255, 154, 1)",
          density: "rgba(79, 212, 255, 0.3)",
          text: "rgba(243, 246, 251, 0.88)",
          region: "rgba(79, 212, 255, 0.12)",
          magnet: "rgba(137, 255, 154, 0.9)"
        };
    const rect = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * scale));
    const height = Math.max(1, Math.round(rect.height * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, w, h);

    const barrierWidth = mode === "nand" ? clamp(50 + barrierNm * 9, 58, 142) : clamp(34 + barrierNm * 12, 46, 130);
    const barrierLeft = w * 0.5 - barrierWidth / 2;
    const barrierRight = w * 0.5 + barrierWidth / 2;
    const baseY = h * 0.5;
    const energyY = h * (0.78 - clamp(electronEnergyEv / Math.max(barrierHeightEv, 0.1), 0.08, 1.35) * 0.42);
    const barrierTop = h * 0.25;
    const barrierBottom = h * 0.76;
    const regionTop = h * 0.18;
    const regionHeight = h * 0.64;
    const drawLabel = (text, x, y, options = {}) => {
      const fontSize = options.fontSize || 12;
      ctx.font = `bold ${fontSize}px ${UI_FONT}`;
      const metrics = ctx.measureText(text);
      const padX = 8;
      const padY = 5;
      const boxW = Math.min(metrics.width + padX * 2, w - 48);
      const boxH = fontSize + padY * 2;
      const boxX = clamp(x, 24, w - boxW - 24);
      const boxY = clamp(y - boxH + 4, 16, h - boxH - 16);
      ctx.fillStyle = options.bg || (isLight ? "rgba(255,255,255,0.92)" : "rgba(3,8,12,0.88)");
      ctx.strokeStyle = options.stroke || (isLight ? "rgba(18,20,23,0.18)" : "rgba(255,255,255,0.16)");
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = options.color || colors.text;
      ctx.fillText(text, boxX + padX, boxY + fontSize + 2);
    };
    const drawTrace = (points, stroke, widthValue = 2, dash = []) => {
      ctx.save();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = widthValue;
      ctx.setLineDash(dash);
      ctx.beginPath();
      points.forEach(([x, y], index) => {
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.restore();
    };
    const drawFilledEnvelope = (points, fill, baseline) => {
      ctx.save();
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(points[0][0], baseline);
      points.forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.lineTo(points[points.length - 1][0], baseline);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    ctx.fillStyle = colors.region;
    if (mode === "nand") {
      const channelY = baseY + 80;
      ctx.fillRect(24, channelY, w - 48, 48);
      ctx.fillStyle = isLight ? "rgba(143, 79, 0, 0.16)" : "rgba(255, 209, 102, 0.12)";
      ctx.fillRect(barrierLeft - 90, regionTop + 36, barrierWidth + 180, 64);
    } else {
      ctx.fillRect(24, regionTop, Math.max(0, barrierLeft - 24), regionHeight);
      ctx.fillRect(barrierRight, regionTop, Math.max(0, w - 24 - barrierRight), regionHeight);
    }

    ctx.strokeStyle = colors.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(24, baseY);
    ctx.lineTo(w - 24, baseY);
    ctx.moveTo(24, h * 0.12);
    ctx.lineTo(24, h * 0.88);
    ctx.stroke();

    const drawPlainTag = (text, x, y, color = colors.text) => {
      ctx.save();
      ctx.fillStyle = color;
      ctx.font = "800 11px Inter, system-ui, sans-serif";
      ctx.fillText(text, clamp(x, 30, w - 170), clamp(y, 22, h - 20));
      ctx.restore();
    };
    if (mode === "nand") {
      drawPlainTag("control gate", barrierLeft - 92, regionTop + 30, colors.energy);
      drawPlainTag("oxide + trap", barrierLeft - 76, barrierBottom + 24, colors.barrierStroke);
      drawPlainTag("silicon channel", 34, h - 28, colors.wave);
      drawPlainTag("leakage path", barrierRight + 18, h - 56, colors.barrierStroke);
    } else {
      drawPlainTag("FM1 fixed layer", 34, h - 34);
      drawPlainTag("Al2O3 barrier", barrierLeft + 6, barrierBottom + 24, colors.barrierStroke);
      drawPlainTag("FM2 free layer", barrierRight + 18, h - 34);
    }

    ctx.fillStyle = colors.barrierFill;
    ctx.strokeStyle = colors.barrierStroke;
    ctx.lineWidth = 2;
    ctx.fillRect(barrierLeft, barrierTop, barrierWidth, barrierBottom - barrierTop);
    ctx.strokeRect(barrierLeft, barrierTop, barrierWidth, barrierBottom - barrierTop);

    ctx.strokeStyle = colors.barrierStroke;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(28, barrierBottom);
    ctx.lineTo(barrierLeft, barrierBottom);
    ctx.lineTo(barrierLeft, barrierTop);
    ctx.lineTo(barrierRight, barrierTop);
    ctx.lineTo(barrierRight, barrierBottom);
    ctx.lineTo(w - 28, barrierBottom);
    ctx.stroke();

    ctx.strokeStyle = colors.energy;
    ctx.setLineDash([7, 7]);
    ctx.beginPath();
    ctx.moveTo(28, energyY);
    ctx.lineTo(w - 28, energyY);
    ctx.stroke();
    ctx.setLineDash([]);

    const t = clamp(transmission, 0, 1);
    const r = clamp(1 - t, 0, 1);
    const ampIn = mode === "nand" ? 34 : 46;
    const ampRef = ampIn * Math.sqrt(r);
    const ampTrans = ampIn * Math.sqrt(t);
    const decay = electronEnergyEv < barrierHeightEv ? kappaNm / 1.45 : 0;
    const kLeft = waveNumber(electronEnergyEv, effectiveMass) / 18;
    const kBarrier = electronEnergyEv >= barrierHeightEv ? waveNumber(electronEnergyEv - barrierHeightEv, effectiveMass) / 18 : 0;

    const wavePoints = [];
    const spinUpPoints = [];
    const spinDownPoints = [];
    const phasePoints = [];
    const densityPoints = [];
    const spinSplit = mode === "spin" ? clamp(0.18 + retentionMargin * 0.32 + spinSplitEv * 1.8, 0.18, 0.68) : 0;
    const phaseBase = baseY + ampIn * 1.18;
    for (let x = 24; x <= w - 24; x += 2) {
      let y;
      let envelopeForDensity = 1;
      if (mode === "nand") {
        const local = Math.abs(x - w * 0.5) / Math.max(1, barrierWidth * 1.4);
        const chargeEnvelope = Math.exp(-local * 2.4) * (0.35 + nandRetention * 0.75);
        const noiseTerm = Math.sin(x * 0.05) * nandError * 28;
        y = baseY + 74 - ampIn * chargeEnvelope + noiseTerm;
        envelopeForDensity = chargeEnvelope;
      } else if (x < barrierLeft) {
        y = baseY + ampIn * Math.sin(x * kLeft - motionPhase) + ampRef * Math.sin(-x * kLeft + 1.2 + motionPhase * 0.7);
        envelopeForDensity = clamp(Math.abs(y - baseY) / Math.max(1, ampIn + ampRef), 0.05, 1);
      } else if (x <= barrierRight) {
        const local = (x - barrierLeft) / Math.max(1, barrierWidth);
        const envelope = electronEnergyEv < barrierHeightEv ? Math.exp(-decay * local * barrierNm) : Math.max(0.4, Math.sqrt(t));
        const oscillation = electronEnergyEv < barrierHeightEv ? (0.92 + Math.sin(motionPhase * 1.8 + local * 12) * 0.08) : Math.sin(x * kBarrier - motionPhase);
        y = baseY + ampIn * envelope * oscillation;
        envelopeForDensity = envelope;
      } else {
        y = baseY + ampTrans * Math.sin((x - barrierRight) * kLeft - motionPhase + 0.4);
        envelopeForDensity = clamp(Math.sqrt(t), 0.02, 1);
      }
      wavePoints.push([x, y]);
      if (mode === "spin") {
        const localProgress = clamp((x - barrierLeft) / Math.max(1, barrierWidth), 0, 1);
        const upEnvelope = x <= barrierLeft
          ? 1
          : x <= barrierRight
            ? Math.exp(-kappaFromBarrier(spinUpBarrierEv, electronEnergyEv, SPINVAULT_EFFECTIVE_MASS) * barrierNm * localProgress / 1.45)
            : Math.sqrt(Math.max(spinUpTransmission, 1e-99)) * 18;
        const downEnvelope = x <= barrierLeft
          ? 0.82
          : x <= barrierRight
            ? Math.exp(-kappaFromBarrier(spinDownBarrierEv, electronEnergyEv, SPINVAULT_EFFECTIVE_MASS) * barrierNm * localProgress / 1.45) * 0.82
            : Math.sqrt(Math.max(spinDownTransmission, 1e-99)) * 18;
        const channel = clamp(upEnvelope, 0.02, 1);
        const spinPhase = x * kLeft - motionPhase - 0.7;
        const separation = ampIn * spinSplit * channel;
        const carrier = Math.sin(spinPhase);
        spinUpPoints.push([x, baseY + carrier * (ampIn * channel + separation * 0.35) - separation]);
        spinDownPoints.push([x, baseY + Math.sin(spinPhase + Math.PI * 0.62) * (ampIn * clamp(downEnvelope, 0.02, 1) * 0.72) + separation]);
        phasePoints.push([x, phaseBase + Math.cos(spinPhase) * 16 * channel]);
        densityPoints.push([x, baseY - Math.min(94, ampIn * channel * channel * (0.55 + Math.abs(carrier) * 0.55))]);
      }
    }

    if (mode === "spin") {
      drawFilledEnvelope(densityPoints, colors.density, baseY);
      drawTrace(spinDownPoints, isLight ? "rgba(0, 95, 134, 0.82)" : "rgba(79, 212, 255, 0.78)", 2.5, [8, 8]);
      drawTrace(spinUpPoints, colors.wave, 4);
      drawTrace(phasePoints, colors.energy, 2, [4, 8]);
    } else {
      ctx.fillStyle = colors.density;
      ctx.beginPath();
      ctx.moveTo(24, baseY);
      wavePoints.forEach(([x, y]) => {
        const densityY = baseY - Math.min(88, Math.abs(y - baseY) * 0.92);
        ctx.lineTo(x, densityY);
      });
      ctx.lineTo(w - 24, baseY);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = colors.wave;
      ctx.lineWidth = 4;
      ctx.beginPath();
      wavePoints.forEach(([x, y], index) => {
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    const retentionY = h * 0.88;
    const leakY = h * 0.84;
    const retentionValue = clamp(retentionProbability ?? retentionMargin, 0, 1);
    const leakValue = clamp(leakProbability ?? transmission, 1e-99, 1);
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = isLight ? "rgba(8,96,41,0.86)" : "rgba(137,255,154,0.9)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(72, retentionY);
    ctx.lineTo(72 + (w - 160) * retentionValue, retentionY);
    ctx.stroke();
    ctx.strokeStyle = colors.barrierStroke;
    ctx.lineWidth = 4;
    ctx.setLineDash([7, 10]);
    ctx.beginPath();
    ctx.moveTo(72, leakY);
    ctx.lineTo(72 + (w - 160) * clamp(Math.sqrt(leakValue) * 8, 0.02, 1), leakY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = colors.text;
    ctx.font = "800 11px Inter, system-ui, sans-serif";
    ctx.fillText(`retention P=${(retentionValue * 100).toFixed(1)}%`, 76, retentionY - 12);
    ctx.fillStyle = colors.barrierStroke;
    ctx.fillText(`leak P=${leakValue.toExponential(2)}`, 76, leakY - 12);
    ctx.restore();

    drawLabel(mode === "spin" ? `T↑=${spinUpTransmission.toExponential(1)}  T↓=${spinDownTransmission.toExponential(1)}` : `Tleak=${transmission.toExponential(2)}`, 28, 32, { color: colors.wave });
    drawLabel(`V0=${barrierHeightEv.toFixed(2)} eV`, barrierLeft + 10, barrierTop + 34, { color: colors.barrierStroke });
    drawLabel(mode === "nand" ? `retention=${Math.round(nandRetention * 100)}%` : `margin=${Math.round(retentionMargin * 100)}%`, w - 190, 32);
    drawPlainTag(mode === "nand" ? "WKB oxide leakage and threshold shift" : electronEnergyEv < barrierHeightEv ? `spin-resolved evanescent tunneling, Δex=${spinSplitEv.toFixed(3)} eV` : "spin-resolved oscillation: E > V0", 30, 72, colors.text);
  };

  let actualCellFrame = null;
  const cssColor = (name) => getComputedStyle(document.body).getPropertyValue(name).trim();
  const drawRoundedRect = (target, x, y, width, height, radius) => {
    target.beginPath();
    target.roundRect(x, y, width, height, radius);
    target.fill();
    target.stroke();
  };
  const startActualCellCanvas = (canvasElement, state) => {
    if (!canvasElement) return;
    if (actualCellFrame) cancelAnimationFrame(actualCellFrame);
    const canvasCtx = canvasElement.getContext("2d");
    if (!canvasCtx) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const started = performance.now();
    const draw = (now) => {
      const rect = canvasElement.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(rect.width * scale));
      const height = Math.max(1, Math.round(rect.height * scale));
      if (canvasElement.width !== width || canvasElement.height !== height) {
        canvasElement.width = width;
        canvasElement.height = height;
      }
      canvasCtx.setTransform(scale, 0, 0, scale, 0, 0);
      const w = rect.width;
      const h = rect.height;
      const t = reduceMotion ? 0.35 : (now - started) / 1000;
      const ink = cssColor("--ink");
      const muted = cssColor("--muted");
      const line = cssColor("--line");
      const accent = cssColor("--accent");
      const accent2 = cssColor("--accent-2");
      const warning = cssColor("--warning");
      const danger = cssColor("--danger");
      const surface = cssColor("--surface-strong");
      const isLight = document.body.classList.contains("light");
      const switchProgress = clamp((now - state.switchStartedAt) / 900, 0, 1);
      const switchEase = 1 - (1 - switchProgress) ** 3;
      const pad = Math.max(18, Math.min(28, w * 0.04));
      const panelW = Math.min(150, Math.max(122, w * 0.17));
      const panelGap = 34;
      const contentRight = w - pad - panelW - panelGap;

      canvasCtx.clearRect(0, 0, w, h);
      canvasCtx.fillStyle = isLight ? "rgba(255,255,255,0.9)" : "rgba(3,8,12,0.88)";
      canvasCtx.fillRect(0, 0, w, h);
      canvasCtx.strokeStyle = line;
      canvasCtx.lineWidth = 1;
      for (let x = 0; x < w; x += 44) {
        canvasCtx.beginPath();
        canvasCtx.moveTo(x, 0);
        canvasCtx.lineTo(x, h);
        canvasCtx.stroke();
      }
      for (let y = 0; y < h; y += 44) {
        canvasCtx.beginPath();
        canvasCtx.moveTo(0, y);
        canvasCtx.lineTo(w, y);
        canvasCtx.stroke();
      }

      const top = 24;
      const stackTop = 104;
      const stackHeight = Math.max(210, h - 174);
      const leftW = w * 0.32;
      const barrierW = Math.max(56, Math.min(104, 36 + state.barrierNm * 17));
      const gap = 34;
      const modelCenterX = (pad + contentRight) / 2;
      const barrierX = modelCenterX - barrierW / 2;
      const barrierRight = barrierX + barrierW;
      const leftX = pad;
      const rightX = barrierX + barrierW + gap;
      const rightW = Math.max(120, contentRight - rightX);
      const leftEnd = barrierX - gap;
      const deviceW = leftEnd - leftX;

      canvasCtx.font = "700 13px Inter, system-ui, sans-serif";
      canvasCtx.fillStyle = accent;
      canvasCtx.fillText(state.mode === "spin" ? "CALCULATED MTJ SINGLE-CELL DYNAMICS" : "CALCULATED NAND SINGLE-CELL DYNAMICS", pad, top);
      canvasCtx.fillStyle = muted;
      canvasCtx.font = "600 12px Inter, system-ui, sans-serif";
      const subtitle = state.mode === "spin"
        ? "Wave phase + evanescent decay + spin readout"
        : "Trap charge + oxide leakage + threshold shift";
      canvasCtx.fillText(subtitle, pad, top + 24);

      const labelPill = (text, x, y, color = accent) => {
        canvasCtx.font = "700 9px Inter, system-ui, sans-serif";
        const textW = canvasCtx.measureText(text).width;
        canvasCtx.fillStyle = isLight ? "rgba(255,255,255,0.94)" : "rgba(4,8,12,0.88)";
        canvasCtx.strokeStyle = line;
        canvasCtx.lineWidth = 1;
        drawRoundedRect(canvasCtx, x, y, textW + 16, 21, 7);
        canvasCtx.fillStyle = color;
        canvasCtx.fillText(text, x + 8, y + 14);
      };

      const layerTag = (text, x, y, color = accent) => {
        canvasCtx.save();
        canvasCtx.font = "700 10px Inter, system-ui, sans-serif";
        canvasCtx.fillStyle = color;
        canvasCtx.textAlign = "left";
        canvasCtx.fillText(text, x, y);
        canvasCtx.restore();
      };

      const drawSideReadout = (items) => {
        const panelX = w - pad - panelW;
        const panelY = 76;
        const rowH = 34;
        canvasCtx.save();
        canvasCtx.fillStyle = isLight ? "rgba(255,255,255,0.9)" : "rgba(5,8,12,0.78)";
        canvasCtx.strokeStyle = line;
        canvasCtx.lineWidth = 1;
        drawRoundedRect(canvasCtx, panelX, panelY, panelW, 30 + items.length * rowH, 14);
        canvasCtx.font = "800 9px Inter, system-ui, sans-serif";
        canvasCtx.fillStyle = accent;
        canvasCtx.letterSpacing = "0.8px";
        canvasCtx.fillText("LIVE VALUES", panelX + 12, panelY + 20);
        items.forEach((item, index) => {
          const y = panelY + 46 + index * rowH;
          canvasCtx.fillStyle = item.color;
          canvasCtx.font = `800 13px ${UI_FONT}`;
          canvasCtx.fillText(item.value, panelX + 12, y);
          canvasCtx.fillStyle = muted;
          canvasCtx.font = "700 9.5px Inter, system-ui, sans-serif";
          canvasCtx.fillText(item.label, panelX + 12, y + 15);
          if (index < items.length - 1) {
            canvasCtx.strokeStyle = line;
            canvasCtx.beginPath();
            canvasCtx.moveTo(panelX + 12, y + 25);
            canvasCtx.lineTo(panelX + panelW - 12, y + 25);
            canvasCtx.stroke();
          }
        });
        canvasCtx.restore();
      };

      if (state.mode === "spin") {
        canvasCtx.fillStyle = isLight ? "rgba(0,95,134,0.1)" : "rgba(79,212,255,0.09)";
        canvasCtx.strokeStyle = accent;
        canvasCtx.lineWidth = 1.5;
        drawRoundedRect(canvasCtx, leftX, stackTop, deviceW, stackHeight, 18);
        drawRoundedRect(canvasCtx, rightX, stackTop, rightW, stackHeight, 18);
        canvasCtx.fillStyle = isLight ? "rgba(179,25,66,0.16)" : "rgba(255,111,143,0.22)";
        canvasCtx.strokeStyle = danger;
        canvasCtx.lineWidth = 3;
        drawRoundedRect(canvasCtx, barrierX, stackTop - 14, barrierW, stackHeight + 28, 18);

        layerTag("FM1 pinned layer", leftX + 18, stackTop + 24, accent);
        layerTag(`Al2O3 barrier ${state.barrierNm.toFixed(1)} nm`, Math.max(pad, barrierX - 42), stackTop - 28, danger);
        layerTag("FM2 free layer", rightX + 18, stackTop + 24, accent);

        const baseY = stackTop + stackHeight * 0.54;
        const k = waveNumber(state.electronEnergyEv, state.effectiveMass) / 26;
        const kappaUp = kappaFromBarrier(state.spinUpBarrierEv, state.electronEnergyEv, SPINVAULT_EFFECTIVE_MASS) / 10;
        const kappaDown = kappaFromBarrier(state.spinDownBarrierEv, state.electronEnergyEv, SPINVAULT_EFFECTIVE_MASS) / 10;
        const amp = Math.min(58, stackHeight * 0.23);
        const freeAlignment = state.parallel ? 1 : -1;
        const spinSelectivity = clamp(0.22 + state.spinPolarization * 0.68, 0.22, 0.9);
        const thermalWobble = clamp(state.disturbance * (1.15 - state.retentionMargin * 0.45), 0, 1);
        const quantumAlpha = clamp(0.18 + Math.sqrt(Math.max(state.effectiveTransmission, 1e-12)) * 14, 0.18, 0.72);

        canvasCtx.save();
        for (let i = 0; i < 7; i += 1) {
          const p = i / 6;
          const y = stackTop - 4 + p * (stackHeight + 8);
          canvasCtx.strokeStyle = isLight ? `rgba(156,18,55,${0.34 + p * 0.18})` : `rgba(255,111,143,${0.38 + p * 0.2})`;
          canvasCtx.lineWidth = 1.8;
          canvasCtx.beginPath();
          canvasCtx.moveTo(barrierX + 8, y);
          canvasCtx.lineTo(barrierRight - 8, y + Math.sin(t * 2.4 + i) * 3);
          canvasCtx.stroke();
        }
        canvasCtx.fillStyle = isLight ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.06)";
        for (let i = 0; i < 5; i += 1) {
          const x = barrierX + 10 + i * ((barrierW - 20) / 4);
          canvasCtx.fillRect(x, stackTop - 8, 2, stackHeight + 16);
        }
        canvasCtx.restore();

        const quantumLeak = clamp(state.leakProbability ?? state.effectiveTransmission, 1e-99, 1);
        const quantumRetention = clamp(state.retentionProbability ?? state.retentionMargin, 0.02, 1);
        const survival = clamp(state.survivalAmplitude ?? Math.sqrt(quantumRetention), 0.02, 1);

        const psiPoint = (x, phaseOffset = 0, spinChannel = "up") => {
          const phase = x * k - t * 7 + phaseOffset;
          let envelope = 1;
          const channelKappa = spinChannel === "up" ? kappaUp : kappaDown;
          const channelTransmission = spinChannel === "up" ? state.spinUpTransmission : state.spinDownTransmission;
          if (x >= barrierX && x <= barrierRight) {
            const progress = (x - barrierX) / Math.max(1, barrierW);
            envelope = state.electronEnergyEv < state.barrierHeightEv
              ? Math.exp(-channelKappa * state.barrierNm * progress)
              : 0.75 + 0.18 * Math.cos(progress * Math.PI * 2);
          } else if (x > barrierRight) {
            envelope = Math.sqrt(Math.max(channelTransmission, 1e-99)) * 18;
          }
          envelope = clamp(envelope, 0.02, 1);
          return {
            y: baseY + Math.sin(phase) * amp * envelope * survival,
            densityY: baseY - Math.abs(Math.sin(phase)) * amp * envelope * envelope * quantumRetention,
            envelope
          };
        };

        const waveEnd = rightX + rightW - 132;
        canvasCtx.fillStyle = isLight ? "rgba(0,95,134,0.24)" : "rgba(79,212,255,0.22)";
        canvasCtx.beginPath();
        canvasCtx.moveTo(leftX + 16, baseY);
        for (let x = leftX + 16; x <= waveEnd; x += 5) {
          const point = psiPoint(x, 0, "up");
          canvasCtx.lineTo(x, point.densityY);
        }
        canvasCtx.lineTo(waveEnd, baseY);
        canvasCtx.closePath();
        canvasCtx.fill();

        canvasCtx.lineWidth = 4.5;
        canvasCtx.strokeStyle = accent2;
        canvasCtx.beginPath();
        for (let x = leftX + 16; x <= waveEnd; x += 4) {
          const point = psiPoint(x, 0, "up");
          if (x === leftX + 16) canvasCtx.moveTo(x, point.y);
          else canvasCtx.lineTo(x, point.y);
        }
        canvasCtx.stroke();

        canvasCtx.save();
        canvasCtx.strokeStyle = accent;
        canvasCtx.lineWidth = 2.4;
        canvasCtx.setLineDash([8, 8]);
        canvasCtx.beginPath();
        for (let x = leftX + 16; x <= waveEnd; x += 5) {
          const point = psiPoint(x, Math.PI * 0.62, "down");
          const y = baseY + (point.y - baseY) * 0.72 + freeAlignment * spinSelectivity * 14 * point.envelope;
          if (x === leftX + 16) canvasCtx.moveTo(x, y);
          else canvasCtx.lineTo(x, y);
        }
        canvasCtx.stroke();
        canvasCtx.restore();

        canvasCtx.save();
        canvasCtx.globalAlpha = clamp(quantumAlpha + 0.16, 0.34, 0.88);
        for (let i = 0; i < 9; i += 1) {
          const p = ((t * (0.16 + spinSelectivity * 0.12)) + i / 9) % 1;
          const start = leftX + 34;
          const end = waveEnd;
          const x = start + (end - start) * p;
          const point = psiPoint(x, i * 0.55, i % 2 ? "down" : "up");
          const helix = Math.sin(p * Math.PI * 10 + t * 5);
          const y = point.y + helix * 8 * point.envelope;
          const radius = 3.5 + spinSelectivity * 4.5;
          canvasCtx.fillStyle = helix > 0 ? accent2 : accent;
          canvasCtx.beginPath();
          canvasCtx.arc(x, y, radius, 0, Math.PI * 2);
          canvasCtx.fill();
          canvasCtx.strokeStyle = helix > 0 ? accent : accent2;
          canvasCtx.lineWidth = 1.2;
          canvasCtx.beginPath();
          canvasCtx.arc(x, y, radius + 6, 0, Math.PI * 1.35);
          canvasCtx.stroke();
        }
        canvasCtx.restore();

        canvasCtx.save();
        const suppression = clamp(1 - Math.sqrt(Math.max(quantumLeak, 1e-99)) * 8, 0.08, 0.999);
        const guardX = barrierX - 18;
        const guardW = barrierW + 36;
        const guardGradient = canvasCtx.createLinearGradient(guardX, 0, guardX + guardW, 0);
        guardGradient.addColorStop(0, "rgba(111,255,139,0)");
        guardGradient.addColorStop(0.5, isLight ? `rgba(8,96,41,${0.12 + suppression * 0.2})` : `rgba(137,255,154,${0.14 + suppression * 0.22})`);
        guardGradient.addColorStop(1, "rgba(111,255,139,0)");
        canvasCtx.fillStyle = guardGradient;
        canvasCtx.fillRect(guardX, stackTop - 6, guardW, stackHeight + 12);
        canvasCtx.strokeStyle = isLight ? "rgba(8,96,41,0.32)" : "rgba(137,255,154,0.34)";
        canvasCtx.lineWidth = 1.2;
        canvasCtx.setLineDash([6, 7]);
        canvasCtx.strokeRect(guardX, stackTop - 6, guardW, stackHeight + 12);
        canvasCtx.setLineDash([]);
        for (let i = 0; i < 5; i += 1) {
          const p = ((t * 0.22) + i / 5) % 1;
          const y = stackTop + 64 + p * (stackHeight - 128);
          const x = barrierX - 22 + Math.sin(t * 2.2 + i) * 8;
          canvasCtx.strokeStyle = danger;
          canvasCtx.lineWidth = 2.2;
          canvasCtx.beginPath();
          canvasCtx.arc(x, y, 7, -Math.PI / 3, Math.PI / 3);
          canvasCtx.stroke();
        }
        labelPill(`leak suppressed ${(suppression * 100).toFixed(1)}%`, Math.max(leftX + 16, barrierX - 150), stackTop + stackHeight - 34, accent2);
        labelPill(`Pret=${(quantumRetention * 100).toFixed(1)}%`, rightX + 16, stackTop + stackHeight - 34, accent2);
        canvasCtx.restore();

        const spinArrow = (cx, cy, direction, phase) => {
          const wobble = Math.sin(t * 5 + phase) * (state.disturbance * 0.7);
          const angle = direction + wobble;
          const len = Math.min(62, deviceW * 0.24);
          const x2 = cx + Math.cos(angle) * len;
          const y2 = cy + Math.sin(angle) * len * 0.28;
          canvasCtx.strokeStyle = accent2;
          canvasCtx.fillStyle = accent2;
          canvasCtx.lineWidth = 5.5;
          canvasCtx.lineCap = "round";
          canvasCtx.beginPath();
          canvasCtx.moveTo(cx - Math.cos(angle) * len * 0.42, cy - Math.sin(angle) * len * 0.12);
          canvasCtx.lineTo(x2, y2);
          canvasCtx.stroke();
          canvasCtx.beginPath();
          canvasCtx.moveTo(x2 + 1, y2);
          canvasCtx.lineTo(x2 - 14, y2 - 8);
          canvasCtx.lineTo(x2 - 11, y2 + 9);
          canvasCtx.closePath();
          canvasCtx.fill();
        };
        spinArrow(leftX + deviceW * 0.5, stackTop + stackHeight * 0.28, 0, 0);
        const previousAngle = state.previousCellState === 1 ? 0 : Math.PI;
        const targetAngle = state.cellState === 1 ? 0 : Math.PI;
        const shortestTurn = ((targetAngle - previousAngle + Math.PI) % (Math.PI * 2)) - Math.PI;
        const freeLayerAngle = previousAngle + shortestTurn * switchEase;
        spinArrow(rightX + rightW * 0.5, stackTop + stackHeight * 0.28, freeLayerAngle, 1.8);

        canvasCtx.save();
        const precessionX = rightX + rightW * 0.5;
        const precessionY = stackTop + stackHeight * 0.28;
        const precessionR = 44 + thermalWobble * 16;
        canvasCtx.strokeStyle = isLight ? "rgba(0,95,134,0.42)" : "rgba(79,212,255,0.44)";
        canvasCtx.lineWidth = 2;
        canvasCtx.beginPath();
        canvasCtx.ellipse(precessionX, precessionY, precessionR, precessionR * 0.34, 0, 0, Math.PI * 2);
        canvasCtx.stroke();
        const dotAngle = t * 3.2 + freeLayerAngle;
        canvasCtx.fillStyle = danger;
        canvasCtx.beginPath();
        canvasCtx.arc(precessionX + Math.cos(dotAngle) * precessionR, precessionY + Math.sin(dotAngle) * precessionR * 0.34, 6, 0, Math.PI * 2);
        canvasCtx.fill();
        canvasCtx.restore();

        drawSideReadout([
          { value: `↑${state.spinUpTransmission.toExponential(1)}`, label: "spin-up tunnel", color: accent2 },
          { value: `↓${state.spinDownTransmission.toExponential(1)}`, label: "spin-down tunnel", color: accent },
          { value: state.parallel ? "P" : "AP", label: "magnetic state", color: warning },
          { value: `${(quantumRetention * 100).toFixed(1)}%`, label: "retention P", color: accent2 }
        ]);
        const gaugeX = w - pad - panelW;
        const gaugeY = h - 92;
        const resistanceRatio = state.parallel ? 1 : 1 + state.tmrRatio;
        canvasCtx.save();
        canvasCtx.fillStyle = isLight ? "rgba(255,255,255,0.86)" : "rgba(5,8,12,0.72)";
        canvasCtx.strokeStyle = line;
        canvasCtx.lineWidth = 1;
        drawRoundedRect(canvasCtx, gaugeX, gaugeY, panelW, 58, 14);
        canvasCtx.fillStyle = muted;
        canvasCtx.font = "700 9px Inter, system-ui, sans-serif";
        canvasCtx.fillText("READOUT", gaugeX + 12, gaugeY + 20);
        canvasCtx.fillStyle = state.parallel ? accent2 : danger;
        canvasCtx.font = `800 13px ${UI_FONT}`;
        canvasCtx.fillText(`${resistanceRatio.toFixed(2)}x ${state.parallel ? "RP" : "RAP"}`, gaugeX + 12, gaugeY + 42);
        canvasCtx.restore();
        if (switchProgress < 1) layerTag("switching free layer", rightX + 18, stackTop + stackHeight - 28, danger);
      } else {
        const cellX = pad + 18;
        const cellW = w - pad * 2 - 36;
        const gateY = stackTop + 18;
        const oxideY = gateY + 82;
        const trapY = oxideY + 78;
        const channelY = Math.min(h - 126, trapY + 132);
        const trapH = Math.max(82, channelY - trapY - 28);
        const quantumLeak = clamp(state.leakProbability ?? state.transmission, 1e-99, 1);
        const quantumRetention = clamp(state.retentionProbability ?? state.nandRetention, 0.02, 1);
        const wkbLeak = clamp(Math.sqrt(quantumLeak) * 8 + state.nandLeakagePressure * 0.58, 0.02, 1);
        const leakParticleCount = Math.max(2, Math.round(3 + wkbLeak * 10));
        canvasCtx.fillStyle = isLight ? "rgba(143,79,0,0.12)" : "rgba(255,209,102,0.12)";
        canvasCtx.strokeStyle = line;
        drawRoundedRect(canvasCtx, cellX, gateY, cellW, 54, 12);
        canvasCtx.fillStyle = isLight ? "rgba(179,25,66,0.14)" : "rgba(255,111,143,0.2)";
        canvasCtx.strokeStyle = danger;
        drawRoundedRect(canvasCtx, cellX + 70, oxideY, cellW - 140, 38, 10);
        canvasCtx.fillStyle = isLight ? "rgba(143,79,0,0.12)" : "rgba(255,209,102,0.14)";
        canvasCtx.strokeStyle = warning;
        drawRoundedRect(canvasCtx, cellX + 42, trapY, cellW - 84, trapH, 18);
        canvasCtx.fillStyle = isLight ? "rgba(0,95,134,0.28)" : "rgba(79,212,255,0.22)";
        canvasCtx.strokeStyle = accent;
        drawRoundedRect(canvasCtx, cellX, channelY, cellW, 30, 15);
        labelPill("control gate", cellX + 18, gateY + 16, warning);
        labelPill(`oxide ${state.barrierNm.toFixed(1)} nm`, cellX + cellW - 160, oxideY + 8, danger);
        labelPill("charge region", cellX + 58, trapY - 24, warning);
        layerTag("silicon channel", cellX + 18, channelY + 20, accent);

        const chargeTotal = 44;
        const previousCharge = state.previousCellState === 1 ? state.nandRetention : clamp(1 - state.nandRetention * 0.86, 0.04, 0.46);
        const activeCharge = previousCharge + (state.chargeOccupancy - previousCharge) * switchEase;
        const previousVt = state.previousCellState === 1 ? state.vtShift : -state.vtShift * 0.44;
        const activeVtShift = previousVt + (state.displayedVtShift - previousVt) * switchEase;
        for (let i = 0; i < chargeTotal; i += 1) {
          const row = Math.floor(i / 11);
          const col = i % 11;
          const visible = i / chargeTotal < activeCharge;
          const jitter = visible ? Math.sin(t * 2.8 + i) * 2.8 : 0;
          const x = cellX + 94 + col * ((cellW - 188) / 10);
          const y = trapY + trapH * 0.5 + (row - 1.5) * 18 + jitter;
          canvasCtx.fillStyle = visible ? warning : (isLight ? "rgba(143,79,0,0.18)" : "rgba(255,209,102,0.16)");
          canvasCtx.beginPath();
          canvasCtx.arc(x, y, visible ? 5.2 : 3.7, 0, Math.PI * 2);
          canvasCtx.fill();
        }

        const leakX = cellX + cellW * 0.62;
        const leakStartY = oxideY + 38;
        const leakEndY = channelY - 2;
        canvasCtx.save();
        const plume = canvasCtx.createLinearGradient(leakX, leakStartY, leakX + 10, leakEndY);
        plume.addColorStop(0, isLight ? `rgba(156,18,55,${0.26 + wkbLeak * 0.22})` : `rgba(255,111,143,${0.3 + wkbLeak * 0.24})`);
        plume.addColorStop(0.55, isLight ? `rgba(156,18,55,${0.14 + wkbLeak * 0.18})` : `rgba(255,111,143,${0.16 + wkbLeak * 0.2})`);
        plume.addColorStop(1, "rgba(255,111,143,0)");
        canvasCtx.strokeStyle = plume;
        canvasCtx.lineWidth = 14 + wkbLeak * 16;
        canvasCtx.lineCap = "round";
        canvasCtx.beginPath();
        canvasCtx.moveTo(leakX, leakStartY);
        canvasCtx.lineTo(leakX + 10, leakEndY);
        canvasCtx.stroke();
        canvasCtx.restore();

        canvasCtx.strokeStyle = danger;
        canvasCtx.lineWidth = 4;
        canvasCtx.setLineDash([12, 10]);
        canvasCtx.beginPath();
        canvasCtx.moveTo(leakX, leakStartY);
        canvasCtx.lineTo(leakX + 10, leakEndY);
        canvasCtx.stroke();
        canvasCtx.setLineDash([]);
        for (let i = 0; i < leakParticleCount; i += 1) {
          const p = ((t * (0.11 + wkbLeak * 0.72)) + i / leakParticleCount) % 1;
          const x = leakX + Math.sin(p * Math.PI) * 26;
          const y = leakStartY + (leakEndY - leakStartY) * p;
          canvasCtx.globalAlpha = 0.18 + wkbLeak * 0.82;
          canvasCtx.fillStyle = danger;
          canvasCtx.beginPath();
          canvasCtx.arc(x, y, 3 + wkbLeak * 4.8, 0, Math.PI * 2);
          canvasCtx.fill();
          canvasCtx.globalAlpha = 1;
        }
        layerTag("leak path", Math.min(cellX + cellW - 104, leakX + 30), oxideY + 70, danger);

        const vtY = channelY + 16 - activeVtShift * 18;
        canvasCtx.strokeStyle = accent2;
        canvasCtx.lineWidth = 3;
        canvasCtx.beginPath();
        for (let x = cellX + 20; x <= cellX + cellW - 20; x += 5) {
          const y = vtY + Math.sin((x / 32) - t * 4) * 7;
          if (x === cellX + 20) canvasCtx.moveTo(x, y);
          else canvasCtx.lineTo(x, y);
        }
        canvasCtx.stroke();
        const metricsY = h - 86;
        const metricGap = 12;
        const metricW = (w - pad * 2 - metricGap * 2) / 3;
        const metricItems = [
          { value: `${Math.round(activeCharge * 100)}%`, label: "stored charge", color: warning },
          { value: quantumLeak.toExponential(1), label: "quantum leak P", color: danger },
          { value: `${activeVtShift.toFixed(2)} V`, label: "threshold shift", color: accent2 }
        ];
        metricItems.forEach((item, index) => {
          const x = pad + index * (metricW + metricGap);
          canvasCtx.fillStyle = isLight ? "rgba(255,255,255,0.9)" : "rgba(5,8,12,0.72)";
          canvasCtx.strokeStyle = line;
          canvasCtx.lineWidth = 1;
          drawRoundedRect(canvasCtx, x, metricsY, metricW, 54, 12);
          canvasCtx.fillStyle = item.color;
          canvasCtx.font = `800 16px ${UI_FONT}`;
          canvasCtx.fillText(item.value, x + 12, metricsY + 24);
          canvasCtx.fillStyle = muted;
          canvasCtx.font = "700 10px Inter, system-ui, sans-serif";
          canvasCtx.fillText(item.label, x + 12, metricsY + 42);
        });
        if (switchProgress < 1) layerTag(state.cellState ? "program pulse" : "erase pulse", cellX + cellW - 132, gateY + 22, danger);
      }

      if (!reduceMotion) {
        actualCellFrame = requestAnimationFrame(draw);
      }
    };
    actualCellFrame = requestAnimationFrame(draw);
  };

  const updateActualCell = ({
    mode,
    barrierHeightEv,
    electronEnergyEv,
    barrierNm,
    transmission,
    leakProbability,
    retentionProbability,
    survivalAmplitude,
    retentionMargin,
    nandRetention,
    nandLeakagePressure,
    tmrRatio,
    delta,
    spinPolarization,
    temperatureK,
    disturbance,
    effectiveMass = 1,
    fieldAssistEv = 0,
    spinSplitEv = 0,
    spinUpBarrierEv = barrierHeightEv,
    spinDownBarrierEv = barrierHeightEv,
    spinUpTransmission = transmission,
    spinDownTransmission = transmission,
    kappaNm = kappaFromBarrier(barrierHeightEv, electronEnergyEv, effectiveMass)
  }) => {
    if (!actualCellDevice) return;
    const tPercent = transmission.toExponential(2);
    const contrast = 1 + tmrRatio;
    const parallel = cellState === 1;
    const chargeOpacity = clamp(0.18 + nandRetention * 0.82, 0.18, 1).toFixed(2);
    const leakOpacity = clamp(0.18 + nandLeakagePressure * 0.82, 0.18, 1).toFixed(2);
    const currentOpacity = clamp(0.18 + Math.sqrt(transmission) * 0.9 + retentionMargin * 0.32, 0.22, 0.9).toFixed(2);
    const channelOpacity = clamp(0.24 + nandRetention * 0.62, 0.24, 0.95).toFixed(2);
    const vtShift = clamp(nandRetention * (0.9 + spinPolarization * 0.35), 0.02, 1.35);
    const tauProxy = clamp((barrierNm ** 2 * barrierHeightEv) / Math.max(0.03, electronEnergyEv + temperatureK * 8.617e-5 + disturbance), 0.1, 200);
    const nandBit = String(cellState);
    const spinBit = String(cellState);
    const chargeCount = Math.max(2, Math.round(26 * nandRetention));
    const chargeDots = Array.from({ length: 26 }, (_, index) => {
      const col = index % 13;
      const row = Math.floor(index / 13);
      const x = 145 + col * 38 + (row ? 18 : 0);
      const y = 288 + row * 42;
      const visible = index < chargeCount;
      return `<circle class="charge-carrier" cx="${x}" cy="${y}" r="8" fill="var(--warning)" opacity="${visible ? chargeOpacity : "0.13"}" style="animation-delay:${(index * 0.08).toFixed(2)}s" />`;
    }).join("");

    actualCellDevice.classList.toggle("nand-cell", mode === "nand");
    actualCellDevice.classList.toggle("spin-cell", mode === "spin");

    const effectiveTransmission = transmission * (cellState ? 1 : 1 / Math.max(1.01, contrast));
    const chargeOccupancy = cellState ? nandRetention : clamp(1 - nandRetention * 0.86, 0.04, 0.46);
    const displayedVtShift = cellState ? vtShift : -vtShift * 0.44;

    const state = {
      mode,
      barrierHeightEv,
      electronEnergyEv,
      barrierNm,
      transmission,
      leakProbability,
      retentionProbability,
      survivalAmplitude,
      retentionMargin,
      nandRetention,
      nandLeakagePressure,
      tmrRatio,
      delta,
      spinPolarization,
      temperatureK,
      disturbance,
      effectiveMass,
      fieldAssistEv,
      spinSplitEv,
      spinUpBarrierEv,
      spinDownBarrierEv,
      spinUpTransmission,
      spinDownTransmission,
      kappaNm,
      contrast,
      parallel,
      bit: String(cellState),
      vtShift,
      displayedVtShift,
      effectiveTransmission,
      chargeOccupancy,
      cellState,
      previousCellState,
      switchStartedAt
    };

    if (mode === "nand") {
      if (actualCellTitle) actualCellTitle.textContent = "Traditional NAND charge retention inside one cell";
      if (actualCellSummary) actualCellSummary.textContent = "A live single-cell model shows the selected 0/1 state as stored charge, leakage through the tunnel oxide, and threshold-voltage shift.";
      if (cellMathOneLabel) cellMathOneLabel.textContent = "Charge retention";
      if (cellMathOne) cellMathOne.textContent = `Pᵣₑₜ = exp(−Γ√Tₗₑₐₖ) = ${((retentionProbability ?? nandRetention) * 100).toFixed(1)}%`;
      if (cellMathOneNote) cellMathOneNote.textContent = "The charge cloud and threshold line use the same quantum leak probability that drives the WKB plume.";
      if (cellMathTwoLabel) cellMathTwoLabel.textContent = "Threshold shift";
      if (cellMathTwo) cellMathTwo.textContent = `ΔVT ≈ Qₜᵣₐₚ / Cₒₓ = ${displayedVtShift.toFixed(2)} V`;
      if (cellMathTwoNote) cellMathTwoNote.textContent = "NAND stores information as threshold-voltage separation; charge loss narrows the read window.";
      if (cellMathThreeLabel) cellMathThreeLabel.textContent = "Oxide tunneling";
      if (cellMathThree) cellMathThree.textContent = `Tₗₑₐₖ ≈ ${(leakProbability ?? transmission).toExponential(2)}, κ = ${kappaNm.toFixed(2)} nm⁻¹`;
      if (cellMathThreeNote) cellMathThreeNote.textContent = `Leak particles and plume intensity scale with WKB tunneling plus ${fieldAssistEv.toFixed(2)} eV field/stress assist.`;
    } else {
      if (actualCellTitle) actualCellTitle.textContent = "SpinVault spintronic MTJ readout inside one cell";
      if (actualCellSummary) actualCellSummary.textContent = "A live single-cell model shows the selected 0/1 magnetic state as wave phase, evanescent decay, spin orientation, and MTJ resistance contrast.";
      if (cellMathOneLabel) cellMathOneLabel.textContent = "Barrier transmission";
      if (cellMathOne) cellMathOne.textContent = `T↑ = ${spinUpTransmission.toExponential(2)}, T↓ = ${spinDownTransmission.toExponential(2)}, κ = ${kappaNm.toFixed(2)} nm⁻¹`;
      if (cellMathOneNote) cellMathOneNote.textContent = `Wave amplitude, density, and carrier motion share exchange-split barriers Δex=${spinSplitEv.toFixed(3)} eV.`;
      if (cellMathTwoLabel) cellMathTwoLabel.textContent = "TMR readout";
      if (cellMathTwo) cellMathTwo.textContent = `TMR = ${Math.round(tmrRatio * 100)}%, RAP/RP ≈ ${contrast.toFixed(2)}`;
      if (cellMathTwoNote) cellMathTwoNote.textContent = "The free-layer orientation changes the readout resistance relative to the pinned layer.";
      if (cellMathThreeLabel) cellMathThreeLabel.textContent = "Thermal stability";
      if (cellMathThree) cellMathThree.textContent = `Pᵣₑₜ = ${((retentionProbability ?? retentionMargin) * 100).toFixed(1)}%, |ψₛᵤᵣᵥᵢᵥₑ| = ${(survivalAmplitude ?? Math.sqrt(retentionMargin)).toFixed(3)}`;
      if (cellMathThreeNote) cellMathThreeNote.textContent = "SpinVault displays retained wave amplitude and rejected leakage at the tunnel barrier.";
    }

    actualCellDevice.innerHTML = `
      <div class="cell-chip-shell rigorous-cell-shell">
        <div class="cell-chip-label">
          <span class="cell-chip-title">
            <strong>${mode === "nand" ? "Traditional NAND single-cell dynamics" : "SpinVault MTJ single-cell dynamics"}</strong>
            <em>${mode === "nand" ? "live trap charge, oxide leakage, and threshold response" : "live wavefunction phase, evanescent decay, spin state, and TMR readout"}</em>
          </span>
          <button class="inline-bit-toggle ${cellState ? "is-one" : "is-zero"}" type="button" data-inline-cell-toggle aria-pressed="${cellState ? "true" : "false"}" aria-label="Switch stored bit between 0 and 1">
            <span>decoded bit</span>
            <i>${cellState}</i>
          </button>
        </div>
        <canvas class="actual-cell-canvas" data-actual-cell-canvas aria-label="${mode === "nand" ? "Animated NAND single cell physics simulation" : "Animated SpinVault MTJ single cell physics simulation"}"></canvas>
        <div class="cell-metric-strip rigorous-metrics">
          ${mode === "nand" ? `
            <div><small>retention probability</small><strong>${((retentionProbability ?? nandRetention) * 100).toFixed(1)}%</strong></div>
            <div><small>quantum leak</small><strong>${(leakProbability ?? transmission).toExponential(1)}</strong></div>
            <div><small>threshold shift</small><strong>${displayedVtShift.toFixed(2)} V</strong></div>
          ` : `
            <div><small>leak probability</small><strong>${(leakProbability ?? effectiveTransmission).toExponential(1)}</strong></div>
            <div><small>retention probability</small><strong>${((retentionProbability ?? retentionMargin) * 100).toFixed(1)}%</strong></div>
            <div><small>leak suppression</small><strong>${((1 - Math.sqrt(Math.max(leakProbability ?? effectiveTransmission, 1e-99)) * 8) * 100).toFixed(1)}%</strong></div>
          `}
        </div>
      </div>
      <div class="actual-device-caption">
        <small>Model scope</small>
        <strong>${mode === "nand" ? "This panel animates the charge-storage mechanism inside one bit cell." : "This panel animates the MTJ read path inside one bit cell."}</strong>
        <p>${mode === "nand" ? "It is a browser-level physics visualization using first-order retention and WKB tunneling intuition, not a foundry TCAD deck." : "It is a browser-level quantum/spin transport visualization using finite-barrier transmission and Julliere TMR, not a full NEGF or LLGS solver."}</p>
      </div>
    `;

    startActualCellCanvas(actualCellDevice.querySelector("[data-actual-cell-canvas]"), state);
    actualCellDevice.querySelector("[data-inline-cell-toggle]")?.addEventListener("click", toggleCellState);
    if (cellMathThreeNote) cellMathThreeNote.textContent = "Delta is an engineering stability ratio. Exact retention time depends on anisotropy, volume, damping, and attempt frequency.";
  };

  const safeCall = (label, fn) => {
    try {
      return fn();
    } catch (error) {
      console.error(`[SpinVault] ${label} failed`, error);
      return undefined;
    }
  };

  const update = () => {
    const barrierHeightEv = Number(field.value) / 100;
    const electronEnergyEv = Number(energy.value) / 100;
    const barrierNm = Number(barrier.value) / 10;
    const spinPolarization = Number(spin.value) / 100;
    const temperatureK = Number(temp.value);
    const disturbance = Number(noise.value) / 100;
    const thermalEv = 8.617e-5 * temperatureK;
    const effectiveBarrierEv = Math.max(0.01, barrierHeightEv - electronEnergyEv);
    const metrics = modelMetrics({ mode: simMode, barrierHeightEv, electronEnergyEv, barrierNm, spinPolarization, temperatureK, disturbance });
    const tunnelProbability = metrics.tunnelProbability;
    const thermalAssist = Math.exp(-effectiveBarrierEv / Math.max(thermalEv, 0.001));
    const kappaNm = metrics.kappaNm;
    const raProxy = clamp(1 / tunnelProbability, 1, 1e99);
    const tmrRatio = (2 * spinPolarization * spinPolarization) / Math.max(0.02, 1 - spinPolarization * spinPolarization);
    const magneticControl = clamp(0.18 + spinPolarization * 0.62 + Math.log10(1 + tmrRatio) * 0.16, 0, 0.95);
    const thermalPressure = clamp((temperatureK - 240) / 180, 0, 1);
    const delta = effectiveBarrierEv / Math.max(thermalEv, 0.001);
    const {
      leakProbability,
      retentionProbability,
      survivalAmplitude,
      nandRetention,
      nandLeakagePressure,
      retentionMargin,
      leakagePressure,
      nandProgramWindow,
      effectiveMass,
      fieldAssistEv,
      spinSplitEv,
      spinUpBarrierEv,
      spinDownBarrierEv,
      spinUpTransmission,
      spinDownTransmission
    } = metrics;
    const attackExposure = clamp(sigmoid((leakagePressure - retentionMargin + disturbance * 0.45) * 3.2), 0.02, 0.98);
    const stabilityScore = Math.round(retentionMargin * 100);
    const leakageScore = Math.round(leakagePressure * 100);
    const attackScore = Math.round(attackExposure * 100);
    const designWindow = simMode === "nand"
      ? retentionMargin > 0.7 && leakagePressure < 0.34
        ? "Strong NAND window"
        : retentionMargin > 0.5 && leakagePressure < 0.55
          ? "Usable NAND range"
          : "NAND stress region"
      : retentionMargin > 0.72 && leakagePressure < 0.28 && tmrRatio > 1
      ? "Strong window"
      : retentionMargin > 0.52 && leakagePressure < 0.46
        ? "Prototype range"
        : "Needs tuning";

    stability.textContent = `${stabilityScore}%`;
    leakage.textContent = `${leakageScore}%`;
    attack.textContent = `${attackScore}%`;
    fieldLabel.textContent = `${barrierHeightEv.toFixed(2)} eV`;
    energyLabel.textContent = `${electronEnergyEv.toFixed(2)} eV`;
    barrierLabel.textContent = `${barrierNm.toFixed(1)} nm`;
    if (spinControlLabel) spinControlLabel.textContent = simMode === "nand" ? "Program coupling / trap quality" : "Spin polarization p1 / p2";
    spinLabel.textContent = simMode === "nand" ? `${Math.round(spinPolarization * 100)}%` : spinPolarization.toFixed(2);
    tempLabel.textContent = `${temperatureK} K`;
    noiseLabel.textContent = `${Math.round(disturbance * 100)}%`;
    tunnelReadout.textContent = tunnelProbability.toExponential(2);
    if (kappaReadout) kappaReadout.textContent = electronEnergyEv < barrierHeightEv ? `${kappaNm.toFixed(2)} nm^-1` : "0.00 nm^-1";
    if (raReadout) raReadout.textContent = raProxy.toExponential(2);
    thermalReadout.textContent = `${thermalEv.toFixed(3)} eV`;
    tmrReadout.textContent = simMode === "nand" ? `${Math.round(nandProgramWindow * 100)}%` : `${Math.round(tmrRatio * 100)}%`;
    deltaReadout.textContent = simMode === "nand" ? `${Math.round(nandRetention * 100)}%` : delta.toFixed(1);
    windowReadout.textContent = designWindow;
    fill.style.width = `${stabilityScore}%`;
    if (reflectionReadout) reflectionReadout.textContent = `${Math.round((1 - tunnelProbability) * 100)}%`;
    if (stateReadout) stateReadout.textContent = simMode === "nand" ? "stored charge threshold shift" : electronEnergyEv < barrierHeightEv ? "evanescent barrier decay" : "above-barrier oscillation";
    if (transmissionBar) transmissionBar.style.width = `${clamp(Math.sqrt(tunnelProbability) * 100, 0, 100)}%`;
    if (reflectionBar) reflectionBar.style.width = `${clamp(Math.sqrt(1 - tunnelProbability) * 100, 0, 100)}%`;
    if (densityBar) densityBar.style.width = `${stabilityScore}%`;
    if (barrierVisual) {
      barrierVisual.style.opacity = String(clamp(0.52 + barrierNm / 7, 0.58, 1));
      barrierVisual.style.boxShadow = `0 0 ${Math.round(10 + magneticControl * 32)}px rgba(118, 211, 255, ${0.18 + magneticControl * 0.32})`;
    }
    if (modelTitle) modelTitle.textContent = simMode === "nand" ? "Traditional NAND charge cell" : "SpinVault spintronic MTJ cell";
    if (modelSummary) modelSummary.textContent = simMode === "nand"
      ? "Floating-gate/charge-trap style model: tunnel oxide leakage, threshold-voltage retention, thermal stress, and disturbance."
      : "Finite rectangular-barrier transmission with visible wavefunction, MTJ stack, TMR readout, and thermal-stability approximation.";
    if (chartLabel) chartLabel.textContent = simMode === "nand" ? "NAND charge retention view" : "Schrodinger barrier view";
    if (chartTitle) chartTitle.textContent = simMode === "nand" ? "charge loss through tunnel oxide in one NAND cell" : "electron wavefunction across one spintronic memory cell";
    if (nativeModelTitle) nativeModelTitle.textContent = simMode === "nand" ? "Traditional NAND single-cell leakage" : "SpinVault MTJ quantum wavefunction";
    if (nativeModelCopy) nativeModelCopy.textContent = simMode === "nand"
      ? "The native website simulator is now showing the NAND reference architecture: control gate, tunnel oxide, charge-storage region, silicon channel, and leakage-driven threshold drift."
      : "The native website simulator is now showing the SpinVault architecture: pinned ferromagnet, Al2O3 tunnel barrier, free ferromagnet, spin-resolved wavefunction decay, and TMR readout.";
    if (nativeWaveTitle) nativeWaveTitle.textContent = simMode === "nand" ? "WKB oxide leakage + retention" : "Spin-resolved finite-barrier ψ↑ / ψ↓";
    if (nativeWaveCopy) nativeWaveCopy.textContent = simMode === "nand"
      ? `Leak probability ${leakProbability.toExponential(2)} drives the charge plume, threshold shift, retention graph, and NAND cell animation.`
      : `ψ↑ and ψ↓ use exchange-split barriers (${spinUpBarrierEv.toFixed(2)} eV / ${spinDownBarrierEv.toFixed(2)} eV), changing transmission, leak pressure, and readout contrast.`;
    if (sourceSimTag) sourceSimTag.textContent = simMode === "nand" ? "Traditional NAND" : "SpinVault";
    if (sourceSimTitle) {
      sourceSimTitle.textContent = simMode === "nand"
        ? (simView === "wave" ? "NAND charge retention view" : "NAND particle leak view")
        : (simView === "wave" ? "SpinVault wavefunction view" : "SpinVault particle transport view");
    }
    if (sourceSimCopy) {
      sourceSimCopy.textContent = simMode === "nand"
        ? (simView === "wave"
          ? "The source-style wave view shows the same WKB-style retention logic used by the simulator, now framed as the NAND reference cell."
          : "The source-style particle view shows charge trapped in the storage region, with only the escape fraction changing as parameters move.")
        : (simView === "wave"
          ? "The source-style wave view shows spin-resolved tunneling through the MTJ barrier, using the same parameter-linked state as the native simulator."
          : "The source-style particle view shows the MTJ readout channel, with transmission changing as the spin state and barrier parameters change.");
    }
    if (tunnelLabel) tunnelLabel.textContent = simMode === "nand" ? "Oxide leakage probability" : "Barrier transmission";
    if (raLabel) raLabel.textContent = simMode === "nand" ? "Retention resistance proxy" : "RA proxy";
    if (tmrLabel) tmrLabel.textContent = simMode === "nand" ? "Program window proxy" : "Julliere TMR";
    if (deltaLabel) deltaLabel.textContent = simMode === "nand" ? "Charge retention score" : "Thermal stability Delta";
    viewButtons.forEach((button) => {
      const active = button.dataset.sourceView === simView;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    if (sourceBitToggle) {
      sourceBitToggle.classList.toggle("is-one", cellState === 1);
      sourceBitToggle.classList.toggle("is-zero", cellState === 0);
      sourceBitToggle.setAttribute("aria-pressed", cellState === 1 ? "true" : "false");
      sourceBitToggle.querySelector("i").textContent = String(cellState);
    }
    if (deviceVisual) deviceVisual.classList.toggle("nand-device", simMode === "nand");
    if (deviceSource) {
      deviceSource.querySelector("span").textContent = simMode === "nand" ? "GATE" : "FM1";
      deviceSource.querySelector("strong").textContent = simMode === "nand" ? "control gate" : "source";
      deviceSource.querySelector("em").textContent = simMode === "nand" ? "word-line voltage programs charge" : "spin-polarized incident state";
    }
    if (barrierVisual) {
      barrierVisual.querySelector("span").textContent = simMode === "nand" ? "SiO2" : "Al2O3";
      barrierVisual.querySelector("strong").textContent = simMode === "nand" ? "tunnel oxide" : "barrier";
      barrierVisual.querySelector("em").textContent = simMode === "nand" ? "charge leakage path" : "width d";
    }
    if (deviceDrain) {
      deviceDrain.querySelector("span").textContent = simMode === "nand" ? "CHANNEL" : "FM2";
      deviceDrain.querySelector("strong").textContent = simMode === "nand" ? "floating charge" : "drain";
      deviceDrain.querySelector("em").textContent = simMode === "nand" ? "threshold shift stores data" : "transmitted readout state";
    }
    caption.textContent = simMode === "nand"
      ? designWindow === "Strong NAND window"
        ? "NAND window: charge retention is acceptable under this stress."
        : designWindow === "Usable NAND range"
          ? "NAND range: usable, but leakage and thermal drift are visible."
          : "NAND stress region: charge loss and disturbance dominate."
      : designWindow === "Strong window"
      ? "Strong window: low tunneling risk, usable TMR contrast."
      : designWindow === "Prototype range"
        ? "Prototype range: model is plausible, needs parameter sweep."
        : "Needs tuning: leakage, heat, or disorder dominates.";

    updateActualCell({
      mode: simMode,
      barrierHeightEv,
      electronEnergyEv,
      barrierNm,
      transmission: tunnelProbability,
      leakProbability,
      retentionProbability,
      survivalAmplitude,
      retentionMargin,
      nandRetention,
      nandLeakagePressure,
      tmrRatio,
      delta,
      spinPolarization,
      temperatureK,
      disturbance,
      effectiveMass,
      fieldAssistEv,
      spinSplitEv,
      spinUpBarrierEv,
      spinDownBarrierEv,
      spinUpTransmission,
      spinDownTransmission,
      kappaNm
    });
    lastWaveParams = {
      mode: simMode,
      barrierHeightEv,
      electronEnergyEv,
      barrierNm,
      transmission: tunnelProbability,
      leakProbability,
      retentionProbability,
      survivalAmplitude,
      retentionMargin,
      nandRetention,
      nandError: leakagePressure,
      effectiveMass,
      spinSplitEv,
      spinUpBarrierEv,
      spinDownBarrierEv,
      spinUpTransmission,
      spinDownTransmission,
      kappaNm
    };
    safeCall("drawWave", () => drawWave(lastWaveParams));
    lastIntegratedSimParams = { barrierHeightEv, electronEnergyEv, barrierNm, spinPolarization, temperatureK, disturbance };
    safeCall("drawIntegratedSimulations", () => drawIntegratedSimulations(lastIntegratedSimParams));
    safeCall("drawExactTheoryGraphs", () => drawExactTheoryGraphs(lastIntegratedSimParams));
    safeCall("drawSimulationGraphs", () => drawSimulationGraphs({ mode: simMode, barrierHeightEv, electronEnergyEv, barrierNm, spinPolarization, temperatureK, disturbance }));
    safeCall("sendOrchestrationSnapshot", () => sendOrchestrationSnapshot({
      mode: simMode,
      bit_state: cellState,
      barrier_height_ev: barrierHeightEv,
      electron_energy_ev: electronEnergyEv,
      barrier_nm: barrierNm,
      spin_polarization: spinPolarization,
      temperature_k: temperatureK,
      disturbance,
      source: "spinvault-website"
    }));
  };

  const graphPointerPosition = (event, graphCanvas) => {
    const rect = graphCanvas.getBoundingClientRect();
    const source = event.touches?.[0] || event.changedTouches?.[0] || event;
    return {
      x: clamp((source.clientX - rect.left - 50) / Math.max(1, rect.width - 72), 0, 1),
      y: clamp((source.clientY - rect.top - 58) / Math.max(1, rect.height - 106), 0, 1)
    };
  };

  const setGraphPointer = (graphCanvas, type, event, shouldCommit = false) => {
    if (!graphCanvas) return;
    event.preventDefault();
    const { x, y } = graphPointerPosition(event, graphCanvas);
    if (type === "retention") {
      graphState.retentionPointer = { x, y, label: `disturbance ${Math.round(x * 100)}%` };
      if (shouldCommit) {
        noise.value = String(Math.round(x * 100));
      }
    } else {
      const widthNm = 0.8 + x * 4.2;
      graphState.transportPointer = { x, y, label: `barrier ${widthNm.toFixed(1)} nm` };
      if (shouldCommit) {
        barrier.value = String(Math.round(widthNm * 10));
      }
    }
    update();
  };

  const bindGraphInteraction = (graphCanvas, type) => {
    if (!graphCanvas) return;
    graphCanvas.setAttribute("tabindex", "0");
    graphCanvas.addEventListener("pointerdown", (event) => {
      graphCanvas.setPointerCapture?.(event.pointerId);
      setGraphPointer(graphCanvas, type, event, true);
    });
    graphCanvas.addEventListener("pointermove", (event) => {
      setGraphPointer(graphCanvas, type, event, event.buttons === 1);
    });
    graphCanvas.addEventListener("mouseenter", (event) => setGraphPointer(graphCanvas, type, event, false));
    graphCanvas.addEventListener("mousemove", (event) => setGraphPointer(graphCanvas, type, event, false));
    graphCanvas.addEventListener("mouseleave", () => {
      if (type === "retention") graphState.retentionPointer = null;
      else graphState.transportPointer = null;
      if (lastGraphParams) drawSimulationGraphs(lastGraphParams);
    });
    graphCanvas.addEventListener("touchstart", (event) => setGraphPointer(graphCanvas, type, event, true), { passive: false });
    graphCanvas.addEventListener("touchmove", (event) => setGraphPointer(graphCanvas, type, event, true), { passive: false });
    graphCanvas.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 0.04 : -0.04;
      const current = type === "retention"
        ? (Number(noise.value) / 100)
        : ((Number(barrier.value) / 10) - 0.8) / 4.2;
      const x = clamp(current + delta, 0, 1);
      if (type === "retention") {
        noise.value = String(Math.round(x * 100));
        graphState.retentionPointer = { x, label: `disturbance ${Math.round(x * 100)}%` };
      } else {
        const widthNm = 0.8 + x * 4.2;
        barrier.value = String(Math.round(widthNm * 10));
        graphState.transportPointer = { x, label: `barrier ${widthNm.toFixed(1)} nm` };
      }
      update();
    });
  };

  const animateGraphsOnce = () => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      graphState.retentionProgress = 1;
      graphState.transportProgress = 1;
      if (lastGraphParams) drawSimulationGraphs(lastGraphParams);
      return;
    }
    const startedAt = performance.now();
    const step = (now) => {
      const progress = clamp((now - startedAt) / 1150, 0, 1);
      const eased = 1 - (1 - progress) ** 3;
      graphState.retentionProgress = eased;
      graphState.transportProgress = clamp(eased - 0.08, 0.02, 1);
      if (lastGraphParams) drawSimulationGraphs(lastGraphParams);
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  bindGraphInteraction(graphRetention, "retention");
  bindGraphInteraction(graphTransport, "transport");

  exactGraphCanvases.forEach((graphCanvas) => {
    const type = graphCanvas.dataset.exactGraph;
    if (!type) return;
    graphCanvas.setAttribute("tabindex", "0");
    const setExactPointer = (event, shouldCommit = false) => {
      event.preventDefault();
      const { x, y } = graphPointerPosition(event, graphCanvas);
      const labels = {
        "spin-transmission": `energy ${(0.05 + x * (Math.max(5, Number(field.value) / 100 + 1.2) - 0.05)).toFixed(2)} eV`,
        "spin-density": `position ${Math.round(x * 100)}%`,
        "nand-transmission": `energy ${(0.05 + x * (Math.max(5, Number(field.value) / 100 + 1.2) - 0.05)).toFixed(2)} eV`,
        "nand-retention": `oxide ${(0.8 + x * 4.2).toFixed(2)} nm`
      };
      graphState.exactPointers[type] = { x, y, label: labels[type] || "cursor" };
      if (shouldCommit && type === "nand-retention") {
        barrier.value = String(Math.round((0.8 + x * 4.2) * 10));
      }
      update();
    };
    graphCanvas.addEventListener("pointerdown", (event) => {
      graphCanvas.setPointerCapture?.(event.pointerId);
      setExactPointer(event, true);
    });
    graphCanvas.addEventListener("pointermove", (event) => {
      if (event.buttons !== 1) return;
      setExactPointer(event, true);
    });
    graphCanvas.addEventListener("touchstart", (event) => setExactPointer(event, true), { passive: false });
    graphCanvas.addEventListener("touchmove", (event) => setExactPointer(event, true), { passive: false });
    graphCanvas.addEventListener("mouseenter", (event) => setExactPointer(event, false));
    graphCanvas.addEventListener("mousemove", (event) => setExactPointer(event, false));
    graphCanvas.addEventListener("mouseleave", () => {
      delete graphState.exactPointers[type];
      if (lastIntegratedSimParams) drawExactTheoryGraphs(lastIntegratedSimParams);
    });
  });

  if ("IntersectionObserver" in window && (graphRetention || graphTransport)) {
    const target = graphRetention?.closest(".simulation-graphs") || graphTransport?.closest(".simulation-graphs");
    const graphObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        animateGraphsOnce();
        graphObserver.disconnect();
      });
    }, { threshold: 0.24 });
    if (target) graphObserver.observe(target);
  } else {
    graphState.retentionProgress = 1;
    graphState.transportProgress = 1;
  }

  modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      simMode = button.dataset.simMode || "spin";
      modeButtons.forEach((item) => item.classList.toggle("active", item === button));
      update();
    });
  });
  viewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      simView = button.dataset.sourceView || "wave";
      viewButtons.forEach((item) => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-selected", active ? "true" : "false");
      });
      update();
    });
  });
  const toggleCellState = () => {
    previousCellState = cellState;
    cellState = cellState ? 0 : 1;
    switchStartedAt = performance.now();
    update();
  };
  sourceBitToggle?.addEventListener("click", toggleCellState);
  [field, energy, barrier, spin, temp, noise].forEach((input) => input.addEventListener("input", update));
  window.addEventListener("resize", update);
  window.addEventListener("spinvault-theme-change", update);
  update();
  window.setTimeout(() => {
    if (lastIntegratedSimParams) safeCall("initial drawIntegratedSimulations", () => drawIntegratedSimulations({ ...lastIntegratedSimParams, now: performance.now() }));
    if (lastWaveParams) safeCall("initial drawWave", () => drawWave({ ...lastWaveParams, now: performance.now() }));
  }, 80);
  const animateIntegratedSimulations = (now) => {
    if (lastIntegratedSimParams) safeCall("animateIntegratedSimulations", () => drawIntegratedSimulations({ ...lastIntegratedSimParams, now }));
    if (lastWaveParams) safeCall("animateWave", () => drawWave({ ...lastWaveParams, now }));
    requestAnimationFrame(animateIntegratedSimulations);
  };
  requestAnimationFrame(animateIntegratedSimulations);
});

const standaloneIntegratedCanvases = Array.from(document.querySelectorAll("[data-integrated-sim]"));
if (standaloneIntegratedCanvases.length) {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const control = (selector, fallback = null) => document.querySelector(selector)?.value ?? fallback;
  const GRAPH_FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const compareReadouts = {
    toggleButtons: Array.from(document.querySelectorAll("[data-model-toggle]")),
    barrier: document.querySelector("#model-barrier-readout"),
    barrierNm: document.querySelector("#model-barrier-nm-readout"),
    energy: document.querySelector("#model-energy-readout"),
    temp: document.querySelector("#model-temp-readout"),
    spin: document.querySelector("#model-spin-readout"),
    disturbance: document.querySelector("#model-disturbance-readout"),
    fill: document.querySelector("[data-model-fill]"),
    mode: document.querySelector("[data-model-mode]"),
    primaryLeak: document.querySelector("[data-model-primary-leak]"),
    primaryRetention: document.querySelector("[data-model-primary-retention]")
  };
  const smallSimToggleButtons = Array.from(document.querySelectorAll("[data-small-sim-toggle]"));
  let smallSimView = smallSimToggleButtons.find((button) => button.classList.contains("active"))?.dataset.smallSimToggle || "wave";
  const sliderPercent = (selector, fallback = 0) => {
    const value = Number(control(selector, String(fallback)));
    return clamp(Number.isFinite(value) ? value / 100 : fallback / 100, 0, 1);
  };
  const mapLogRange = (t, min, max) => min * ((max / min) ** clamp(t, 0, 1));
  const mapEaseRange = (t, min, max) => {
    const u = clamp(t, 0, 1);
    const eased = u * u * (3 - 2 * u);
    return min + (max - min) * eased;
  };
  const mapLinearRange = (t, min, max) => min + (max - min) * clamp(t, 0, 1);
  const mapSpinRange = (t) => mapEaseRange(t, 0.12, 0.98);
  const getCompareParams = () => ({
    mode: document.querySelector("[data-model-toggle].active")?.dataset.modelToggle || "nand",
    barrierEv: mapEaseRange(sliderPercent("#model-barrier", 42), 1.4, 4.6),
    barrierNm: mapEaseRange(sliderPercent("#model-barrier", 42), 0.9, 5.0),
    electronEnergyEv: mapEaseRange(sliderPercent("#model-energy", 50), 0.08, 1.02),
    temperatureK: Math.round(mapEaseRange(sliderPercent("#model-temp", 34), 180, 420)),
    spinPolarization: mapSpinRange(sliderPercent("#model-spin", 72)),
    disturbance: mapEaseRange(sliderPercent("#model-disturbance", 20), 0.03, 0.46)
  });
  const computeLeakyRetention = ({ mode, barrierEv, barrierNm, electronEnergyEv, temperatureK, spinPolarization, disturbance }) => {
    const electronCharge = 1.602176634e-19;
    const reducedPlanck = 1.054571817e-34;
    const electronMass = 9.1093837015e-31;
    const barrierWidthNm = Number.isFinite(barrierNm) ? barrierNm : (mode === "spinvault" ? 4.1 : 1.95);
    const barrierWidthM = barrierWidthNm * 1e-9;
    const effectiveMass = (mode === "spinvault" ? 0.58 : 0.29) * electronMass;
    const deltaEv = Math.max(barrierEv + (mode === "spinvault" ? 0.48 : -0.42) - electronEnergyEv, 0.025);
    const deltaJ = deltaEv * electronCharge;
    const transmission = Math.exp((-2 * barrierWidthM * Math.sqrt(2 * effectiveMass * deltaJ)) / reducedPlanck);
    const p1 = clamp(mode === "spinvault" ? 0.9 + spinPolarization * 0.1 : 0.12 + spinPolarization * 0.26, 0.02, 0.99);
    const p2 = clamp(spinPolarization, 0.02, 0.99);
    const tmr = (2 * p1 * p2) / Math.max(0.001, 1 - (p1 * p2));
    const thermal = 1 + Math.max(0, (temperatureK - 300) / (mode === "spinvault" ? 900 : 420));
    const agitation = 1 + disturbance * (mode === "spinvault" ? 0.14 : 0.62);
    const tunnelPressure = Math.pow(Math.max(transmission, 1e-40), mode === "spinvault" ? 0.11 : 0.24);
    const spinGate = mode === "spinvault" ? 0.05 + (1 - p1) * 0.08 : 0.34 + (1 - p1) * 0.32;
    const leak = clamp(tunnelPressure * thermal * agitation * spinGate / (1 + Math.log10(1 + tmr)), 1e-8, 0.999999999999);
    const retention = clamp(1 - leak, 1e-12, 0.999999999999);
    const retentionDelta = deltaEv / Math.max(1e-6, 8.617333262145e-5 * temperatureK);
    return { leak, retention, transmission, tmr, retentionDelta };
  };
  const formatLeak = (value) => `${(value * 100).toFixed(value < 0.01 ? 4 : 2)}%`;
  const formatRetention = (value) => `${(value * 100).toFixed(value < 0.01 ? 4 : 2)}%`;
  const updateCompareReadouts = (params) => {
    const traditional = computeLeakyRetention({
      mode: "nand",
      ...params,
      barrierEv: Math.max(0.35, params.barrierEv),
      electronEnergyEv: Math.max(0.01, params.electronEnergyEv),
      temperatureK: params.temperatureK,
      spinPolarization: clamp(params.spinPolarization * 0.08, 0.02, 0.99),
      disturbance: clamp(params.disturbance + 0.35, 0, 1)
    });
    const spinvault = computeLeakyRetention({
      mode: "spinvault",
      ...params,
      barrierEv: Math.min(7.2, params.barrierEv),
      electronEnergyEv: Math.max(0.01, params.electronEnergyEv),
      temperatureK: params.temperatureK,
      spinPolarization: Math.min(0.99, params.spinPolarization),
      disturbance: clamp(params.disturbance * 0.18, 0, 1)
    });
    const active = params.mode === "spinvault" ? spinvault : traditional;
    compareReadouts.barrier && (compareReadouts.barrier.textContent = `${params.barrierEv.toFixed(2)} eV`);
    compareReadouts.barrierNm && (compareReadouts.barrierNm.textContent = `${params.barrierNm.toFixed(1)} nm`);
    compareReadouts.energy && (compareReadouts.energy.textContent = `${params.electronEnergyEv.toFixed(2)} eV`);
    compareReadouts.temp && (compareReadouts.temp.textContent = `${Math.round(params.temperatureK)} K`);
    compareReadouts.spin && (compareReadouts.spin.textContent = `${Math.round(params.spinPolarization * 100)}%`);
    compareReadouts.disturbance && (compareReadouts.disturbance.textContent = `${Math.round(params.disturbance * 100)}%`);
    compareReadouts.fill && (compareReadouts.fill.style.width = `${Math.round(clamp(active.retention, 0.02, 0.999999) * 100)}%`);
    compareReadouts.mode && (compareReadouts.mode.textContent = params.mode === "spinvault" ? "SpinVault" : "Traditional NAND");
    compareReadouts.primaryLeak && (compareReadouts.primaryLeak.textContent = formatLeak(active.leak));
    compareReadouts.primaryRetention && (compareReadouts.primaryRetention.textContent = formatRetention(active.retention));
  };
  const fitCanvas = (canvas) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const rect = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * scale));
    const height = Math.max(1, Math.round(rect.height * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    return { ctx, width: rect.width, height: rect.height };
  };
  const drawRounded = (ctx, x, y, width, height, radius, fill, stroke = null, lineWidth = 1) => {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  };
  const drawGrid = (ctx, w, h, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += 44) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += 44) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  };
  const drawFrame = (ctx, w, h, isLight) => {
    ctx.save();
    ctx.strokeStyle = isLight ? "rgba(18,20,23,0.10)" : "rgba(79,212,255,0.24)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(14, 14, w - 28, h - 28, 18);
    ctx.stroke();
    ctx.restore();
  };
  const drawWaveCell = (ctx, w, h, now, isLight, params) => {
    const yellow = "#ffd166";
    const pink = "#ff6f8f";
    const darkPanel = isLight ? "rgba(0, 95, 134, 0.05)" : "rgba(10, 48, 62, 0.72)";
    const barrierFill = "rgba(255, 107, 141, 0.28)";
    const barrierStroke = "rgba(255, 111, 143, 0.96)";
    const mutedStroke = isLight ? "rgba(18,20,23,0.14)" : "rgba(255,255,255,0.13)";
    const innerX = 36;
    const innerY = 42;
    const innerW = w - 72;
    const innerH = h - 86;
    const cellX = innerX + 36;
    const cellY = innerY + 34;
    const cellW = innerW - 72;
    const cellH = innerH - 56;
    const barrierLeft = cellX + cellW * 0.44;
    const barrierWidth = Math.max(16, cellW * 0.074);
    const barrierRight = barrierLeft + barrierWidth;
    const leftWell = { x: cellX + 4, y: cellY + 8, w: cellW * 0.40, h: cellH - 8 };
    const rightWell = { x: barrierRight + 16, y: cellY + 8, w: cellW * 0.40, h: cellH - 8 };
    const waveY = cellY + cellH * 0.62;
    const time = now / 1000;
    const leakPct = clamp(params.leak * 100, 1, 99);
    const storedPct = clamp(params.retention * 100, 1, 99);
    ctx.fillStyle = darkPanel;
    drawRounded(ctx, 24, 42, w - 48, h - 86, 18, darkPanel);
    ctx.fillStyle = "rgba(79, 212, 255, 0.04)";
    ctx.fillRect(leftWell.x, leftWell.y, leftWell.w, leftWell.h);
    ctx.fillRect(rightWell.x, rightWell.y, rightWell.w, rightWell.h);
    drawRounded(ctx, barrierLeft, cellY + 8, barrierWidth, cellH - 16, 18, barrierFill, barrierStroke, 5);
    const kLeft = 0.0086 + params.electronEnergyEv * 0.0008;
    const kRight = 0.0065 + params.electronEnergyEv * 0.0007;
    const kappa = 3.8 + Math.max(params.barrierEv - params.electronEnergyEv, 0.03) * 2.6;
    const path = (x0, x1, fn, color, width = 6) => {
      ctx.beginPath();
      for (let i = 0; i <= 180; i += 1) {
        const t = i / 180;
        const x = x0 + (x1 - x0) * t;
        const y = fn(t, x);
        if (!i) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    };
    path(leftWell.x + 8, barrierLeft - 10, (_t, x) => {
      const a = Math.exp(-(x - leftWell.x) * 0.0023);
      return waveY + Math.sin(time * 1.3 + x * kLeft) * 24 * a + Math.sin(time * 0.42 + x * 0.015) * 3;
    }, yellow, 7);
    path(barrierLeft + 2, barrierRight - 2, (t) => {
      const drop = Math.exp(-kappa * (t * 1.7));
      return waveY + 12 - t * 92 + Math.sin(time * 1.8 + t * 10) * 4 * drop;
    }, pink, 6);
    path(barrierRight + 8, rightWell.x + rightWell.w - 10, (_t, x) => {
      const a = Math.exp(-(x - barrierRight) * 0.0034);
      return waveY + Math.sin(time * 1.05 + x * kRight) * 18 * a + Math.sin(time * 0.33 + x * 0.01) * 2;
    }, yellow, 7);
    ctx.setLineDash([10, 10]);
    ctx.strokeStyle = pink;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(cellX + 6, cellY + cellH * 0.81);
    ctx.lineTo(cellX + cellW - 6, cellY + cellH * 0.81);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = yellow;
    ctx.font = `500 15px ${GRAPH_FONT}`;
    ctx.fillText("FM1 pinned", leftWell.x + 12, cellY - 12);
    ctx.fillStyle = pink;
    ctx.fillText("FM2 free", rightWell.x + 24, cellY - 12);
    drawRounded(ctx, cellX + 10, cellY + 10, 174, 48, 16, "rgba(24, 28, 33, 0.88)", "rgba(255,255,255,0.14)", 3);
    drawRounded(ctx, cellX + 10, cellY + 66, 120, 48, 16, "rgba(24, 28, 33, 0.88)", "rgba(255,255,255,0.14)", 3);
    ctx.fillStyle = yellow;
    ctx.font = `500 17px ${GRAPH_FONT}`;
    ctx.fillText(`Tleak=${leakPct.toFixed(1)}e-2`, cellX + 22, cellY + 41);
    ctx.fillText(`Pret=${Math.round(storedPct)}%`, cellX + 22, cellY + 97);
    drawRounded(ctx, cellX + 18, h - 60, 204, 46, 18, "rgba(21, 30, 35, 0.88)", "rgba(255,255,255,0.12)", 3);
    drawRounded(ctx, rightWell.x + rightWell.w - 112, h - 60, 178, 46, 18, "rgba(21, 30, 35, 0.88)", "rgba(255,255,255,0.12)", 3);
    ctx.fillStyle = yellow;
    ctx.font = `500 18px ${GRAPH_FONT}`;
    ctx.fillText(`stored ${Math.round(storedPct)}%`, cellX + 34, h - 29);
    ctx.fillStyle = pink;
    ctx.fillText(`leak ${Math.round(leakPct)}%`, rightWell.x + rightWell.w - 79, h - 29);
    ctx.strokeStyle = mutedStroke;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(52, h - 74);
    ctx.lineTo(w - 52, h - 74);
    ctx.stroke();
  };
  const drawParticleCell = (ctx, w, h, now, isLight, params) => {
    const leakPct = clamp(params.leak * 100, 1, 99);
    const retentionPct = clamp(params.retention * 100, 1, 99);
    const fg = isLight ? "rgba(18,20,23,0.96)" : "rgba(243,246,251,0.94)";
    const muted = isLight ? "rgba(18,20,23,0.68)" : "rgba(243,246,251,0.72)";
    const blueWell = "rgba(15, 51, 60, 0.78)";
    const barrierFill = "rgba(255, 111, 143, 0.34)";
    const barrierStroke = "#ff6f8f";
    const leftWell = { x: 52, y: 180, w: w * 0.38, h: h * 0.50 };
    const rightWell = { x: w * 0.60, y: 180, w: w * 0.34, h: h * 0.50 };
    const barrierX = w * 0.43;
    const barrierW = 180;
    const time = now / 1000;
    ctx.fillStyle = isLight ? "rgba(0,95,134,0.06)" : "rgba(10, 48, 62, 0.72)";
    drawRounded(ctx, 24, 42, w - 48, h - 86, 18, isLight ? "rgba(0,95,134,0.06)" : "rgba(10, 48, 62, 0.72)");
    ctx.fillStyle = blueWell;
    ctx.fillRect(leftWell.x, leftWell.y, leftWell.w, leftWell.h);
    ctx.fillRect(rightWell.x, rightWell.y, rightWell.w, rightWell.h);
    drawRounded(ctx, barrierX, 126, barrierW, h - 220, 22, barrierFill, barrierStroke, 5);
    ctx.fillStyle = "rgba(79,212,255,0.06)";
    ctx.fillRect(leftWell.x + 8, leftWell.y + 8, leftWell.w - 16, leftWell.h - 16);
    ctx.fillRect(rightWell.x + 8, rightWell.y + 8, rightWell.w - 16, rightWell.h - 16);
    const leftCount = 28;
    const escapedCount = Math.max(2, Math.round(4 + leakPct * 0.35));
    const particleColor = params.mode === "spinvault" ? "#89ff9a" : "#ffd166";
    const escapeColor = "#ff6f8f";
    const jitter = (seed) => Math.sin(time * 1.5 + seed * 1.7) * 2.2;
    const randomX = (i, width) => (i * 37 + Math.sin(i * 1.7) * 13) % Math.max(40, width);
    const randomY = (i, height) => (i * 29 + Math.cos(i * 1.3) * 11) % Math.max(40, height);
    for (let i = 0; i < leftCount; i += 1) {
      const x = leftWell.x + 28 + randomX(i, leftWell.w - 48);
      const y = leftWell.y + 28 + randomY(i, leftWell.h - 48);
      ctx.fillStyle = `rgba(255, 211, 102, ${0.78 - (i / leftCount) * 0.18})`;
      ctx.beginPath();
      ctx.arc(x + jitter(i), y + jitter(i + 8) * 0.7, 16, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < escapedCount; i += 1) {
      const x = rightWell.x + 60 + ((i * 42) % Math.max(40, rightWell.w - 80));
      const y = rightWell.y + 54 + ((i * 37) % Math.max(40, rightWell.h - 100));
      ctx.fillStyle = `rgba(255, 111, 143, ${0.88 - (i / escapedCount) * 0.22})`;
      ctx.beginPath();
      ctx.arc(x + Math.sin(time * 1.4 + i) * 2.3, y + Math.cos(time * 1.1 + i * 0.6) * 2, 16, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(79,212,255,0.10)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(leftWell.x + 12, leftWell.y + leftWell.h * 0.54);
    ctx.lineTo(barrierX - 12, leftWell.y + leftWell.h * 0.54);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(barrierX + barrierW + 12, leftWell.y + leftWell.h * 0.54);
    ctx.lineTo(rightWell.x + rightWell.w - 12, leftWell.y + leftWell.h * 0.54);
    ctx.stroke();
    ctx.fillStyle = particleColor;
    ctx.font = `500 20px ${GRAPH_FONT}`;
    ctx.fillText("FM1 pinned", leftWell.x + 24, 96);
    ctx.fillStyle = "#ff6f8f";
    ctx.fillText("FM2 free", rightWell.x + 16, 96);
    drawRounded(ctx, 88, h - 142, 176, 48, 18, "rgba(21, 30, 35, 0.88)", "rgba(255,255,255,0.12)", 3);
    drawRounded(ctx, w - 246, h - 142, 170, 48, 18, "rgba(21, 30, 35, 0.88)", "rgba(255,255,255,0.12)", 3);
    ctx.fillStyle = particleColor;
    ctx.font = `500 18px ${GRAPH_FONT}`;
    ctx.fillText(`stored=${Math.round(retentionPct)}%`, 110, h - 111);
    ctx.fillStyle = escapeColor;
    ctx.fillText(`leak=${Math.round(leakPct)}%`, w - 214, h - 111);
    ctx.strokeStyle = muted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(52, h - 166);
    ctx.lineTo(w - 52, h - 166);
    ctx.stroke();
  };
  const drawStandalone = (canvas, now) => {
    const fitted = fitCanvas(canvas);
    if (!fitted) return;
    const { ctx, width: w, height: h } = fitted;
    const isLight = document.body.classList.contains("light");
    const compare = getCompareParams();
    const mode = smallSimView;
    const leakModel = mode === "wave"
      ? computeLeakyRetention({
        barrierEv: compare.barrierEv + 0.35,
        electronEnergyEv: compare.electronEnergyEv,
        temperatureK: compare.temperatureK - 10,
        spinPolarization: Math.min(0.99, compare.spinPolarization + 0.24),
        disturbance: compare.disturbance * 0.55
      })
      : computeLeakyRetention({
        barrierEv: compare.barrierEv - 0.55,
        electronEnergyEv: compare.electronEnergyEv + 0.22,
        temperatureK: compare.temperatureK + 22,
        spinPolarization: compare.spinPolarization * 0.18,
        disturbance: Math.min(1, compare.disturbance + 0.22)
      });
    const displayParams = {
      ...compare,
      leak: leakModel.leak,
      retention: leakModel.retention
    };
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = isLight ? "#ffffff" : "#05070a";
    ctx.fillRect(0, 0, w, h);
    drawGrid(ctx, w, h, isLight ? "rgba(18,20,23,0.055)" : "rgba(255,255,255,0.06)");
    drawFrame(ctx, w, h, isLight);
    if (mode === "wave") {
      drawWaveCell(ctx, w, h, now, isLight, displayParams);
    } else {
      drawParticleCell(ctx, w, h, now, isLight, displayParams);
    }
    ctx.restore();
  };
  const safeDrawStandalone = (canvas, now) => {
    try {
      drawStandalone(canvas, now);
    } catch (error) {
      console.error("Standalone sim render failed:", canvas?.dataset?.integratedSim, error);
    }
  };
  const setSmallSimView = (view) => {
    smallSimView = view;
    smallSimToggleButtons.forEach((button) => {
      const active = button.dataset.smallSimToggle === view;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    standaloneIntegratedCanvases.forEach((canvas) => safeDrawStandalone(canvas, performance.now()));
  };
  const animate = (now) => {
    updateCompareReadouts(getCompareParams());
    standaloneIntegratedCanvases.forEach((canvas) => safeDrawStandalone(canvas, now));
    requestAnimationFrame(animate);
  };
  compareReadouts.toggleButtons.forEach((button) => {
    const activate = () => {
      compareReadouts.toggleButtons.forEach((item) => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-selected", active ? "true" : "false");
      });
      updateCompareReadouts(getCompareParams());
      standaloneIntegratedCanvases.forEach((canvas) => safeDrawStandalone(canvas, performance.now()));
    };
    button.addEventListener("click", activate);
    button.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
    });
  });
  smallSimToggleButtons.forEach((button) => {
    const activate = () => setSmallSimView(button.dataset.smallSimToggle || "wave");
    button.addEventListener("click", activate);
    button.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
    });
  });
  document.querySelectorAll("#compare-model input[type='range']").forEach((input) => {
    input.addEventListener("input", () => updateCompareReadouts(getCompareParams()));
  });
  window.addEventListener("resize", () => standaloneIntegratedCanvases.forEach((canvas) => safeDrawStandalone(canvas, performance.now())));
  window.addEventListener("spinvault-theme-change", () => standaloneIntegratedCanvases.forEach((canvas) => safeDrawStandalone(canvas, performance.now())));
  setSmallSimView(smallSimView);
  requestAnimationFrame(animate);
}

if (!standaloneIntegratedCanvases.length) {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const control = (selector, fallback = null) => document.querySelector(selector)?.value ?? fallback;
  const compareReadouts = {
    toggleButtons: Array.from(document.querySelectorAll("[data-model-toggle]")),
    barrier: document.querySelector("#model-barrier-readout"),
    barrierNm: document.querySelector("#model-barrier-nm-readout"),
    energy: document.querySelector("#model-energy-readout"),
    temp: document.querySelector("#model-temp-readout"),
    spin: document.querySelector("#model-spin-readout"),
    disturbance: document.querySelector("#model-disturbance-readout"),
    fill: document.querySelector("[data-model-fill]"),
    mode: document.querySelector("[data-model-mode]"),
    primaryLeak: document.querySelector("[data-model-primary-leak]"),
    primaryRetention: document.querySelector("[data-model-primary-retention]")
  };
  const sliderPercent = (selector, fallback = 0) => {
    const value = Number(control(selector, String(fallback)));
    return clamp(Number.isFinite(value) ? value / 100 : fallback / 100, 0, 1);
  };
  const mapLogRange = (t, min, max) => min * ((max / min) ** clamp(t, 0, 1));
  const mapEaseRange = (t, min, max) => {
    const u = clamp(t, 0, 1);
    const eased = u * u * (3 - 2 * u);
    return min + (max - min) * eased;
  };
  const mapLinearRange = (t, min, max) => min + (max - min) * clamp(t, 0, 1);
  const mapSpinRange = (t) => mapLinearRange(t, 0.05, 0.99);
  const getCompareParams = () => ({
    mode: document.querySelector("[data-model-toggle].active")?.dataset.modelToggle || "nand",
    barrierEv: mapLinearRange(sliderPercent("#model-barrier", 42), 0.8, 6.8),
    barrierNm: mapLinearRange(sliderPercent("#model-barrier", 42), 0.9, 5.0),
    electronEnergyEv: mapLinearRange(sliderPercent("#model-energy", 50), 0.01, 1.2),
    temperatureK: Math.round(mapLinearRange(sliderPercent("#model-temp", 34), 80, 700)),
    spinPolarization: mapSpinRange(sliderPercent("#model-spin", 72)),
    disturbance: mapLinearRange(sliderPercent("#model-disturbance", 20), 0, 1)
  });
  const computeLeakyRetention = ({ mode, barrierEv, barrierNm, electronEnergyEv, temperatureK, spinPolarization, disturbance }) => {
    const electronCharge = 1.602176634e-19;
    const reducedPlanck = 1.054571817e-34;
    const electronMass = 9.1093837015e-31;
    const barrierWidthNm = Number.isFinite(barrierNm) ? barrierNm : (mode === "spinvault" ? 3.4 : 2.35);
    const barrierWidthM = barrierWidthNm * 1e-9;
    const effectiveMass = (mode === "spinvault" ? 0.52 : 0.34) * electronMass;
    const deltaEv = Math.max(barrierEv + (mode === "spinvault" ? 0.24 : -0.18) - electronEnergyEv, 0.015);
    const deltaJ = deltaEv * electronCharge;
    const transmission = Math.exp((-2 * barrierWidthM * Math.sqrt(2 * effectiveMass * deltaJ)) / reducedPlanck);
    const p1 = clamp(mode === "spinvault" ? 0.86 + spinPolarization * 0.14 : spinPolarization * 0.42, 0.02, 0.99);
    const p2 = clamp(spinPolarization, 0.02, 0.99);
    const tmr = (2 * p1 * p2) / Math.max(0.001, 1 - (p1 * p2));
    const thermal = 1 + Math.max(0, (temperatureK - 300) / 700);
    const agitation = 1 + disturbance * (mode === "spinvault" ? 0.22 : 0.38);
    const tunnelPressure = Math.pow(Math.max(transmission, 1e-40), mode === "spinvault" ? 0.18 : 0.13);
    const spinGate = mode === "spinvault" ? 0.78 + p1 * 0.22 : 0.24 + p1 * 0.28;
    const leak = clamp(tunnelPressure * thermal * agitation * spinGate / (1 + Math.log10(1 + tmr)), 1e-8, 0.999999999999);
    const retention = clamp(1 - leak, 1e-12, 0.999999999999);
    const retentionDelta = deltaEv / Math.max(1e-6, 8.617333262145e-5 * temperatureK);
    return { leak, retention, transmission, tmr, retentionDelta };
  };
  const formatLeak = (value) => `${(value * 100).toFixed(value < 0.01 ? 4 : 2)}%`;
  const formatRetention = (value) => `${(value * 100).toFixed(value < 0.01 ? 4 : 2)}%`;
  const updateCompareReadouts = (params) => {
    const traditional = computeLeakyRetention({
      ...params,
      barrierEv: Math.max(0.35, params.barrierEv),
      electronEnergyEv: Math.max(0.01, params.electronEnergyEv),
      temperatureK: params.temperatureK,
      spinPolarization: clamp(params.spinPolarization * 0.08, 0.02, 0.99),
      disturbance: clamp(params.disturbance + 0.35, 0, 1)
    });
    const spinvault = computeLeakyRetention({
      ...params,
      barrierEv: Math.min(7.2, params.barrierEv),
      electronEnergyEv: Math.max(0.01, params.electronEnergyEv),
      temperatureK: params.temperatureK,
      spinPolarization: Math.min(0.99, params.spinPolarization),
      disturbance: clamp(params.disturbance * 0.18, 0, 1)
    });
    const active = params.mode === "spinvault" ? spinvault : traditional;
    compareReadouts.barrier && (compareReadouts.barrier.textContent = `${params.barrierEv.toFixed(2)} eV`);
    compareReadouts.barrierNm && (compareReadouts.barrierNm.textContent = `${params.barrierNm.toFixed(1)} nm`);
    compareReadouts.energy && (compareReadouts.energy.textContent = `${params.electronEnergyEv.toFixed(2)} eV`);
    compareReadouts.temp && (compareReadouts.temp.textContent = `${Math.round(params.temperatureK)} K`);
    compareReadouts.spin && (compareReadouts.spin.textContent = `${Math.round(params.spinPolarization * 100)}%`);
    compareReadouts.disturbance && (compareReadouts.disturbance.textContent = `${Math.round(params.disturbance * 100)}%`);
    compareReadouts.fill && (compareReadouts.fill.style.width = `${Math.round(clamp(active.retention, 0.02, 0.999999) * 100)}%`);
    compareReadouts.mode && (compareReadouts.mode.textContent = params.mode === "spinvault" ? "SpinVault" : "Traditional NAND");
    compareReadouts.primaryLeak && (compareReadouts.primaryLeak.textContent = formatLeak(active.leak));
    compareReadouts.primaryRetention && (compareReadouts.primaryRetention.textContent = formatRetention(active.retention));
  };
  const refreshCompare = () => updateCompareReadouts(getCompareParams());
  compareReadouts.toggleButtons.forEach((button) => {
    const activate = () => {
      compareReadouts.toggleButtons.forEach((item) => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-selected", active ? "true" : "false");
      });
      refreshCompare();
    };
    button.addEventListener("click", activate);
    button.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
    });
  });
  document.querySelectorAll("#compare-model input[type='range']").forEach((input) => {
    input.addEventListener("input", refreshCompare);
  });
  refreshCompare();
}

document.querySelectorAll("[data-digital-twin]").forEach((twin) => {
  const canvas = twin.querySelector("[data-twin-canvas]");
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return;
  const inputs = Object.fromEntries(Array.from(twin.querySelectorAll("[data-twin-input]")).map((node) => [node.dataset.twinInput, node]));
  const readouts = Object.fromEntries(Array.from(twin.querySelectorAll("[data-twin-readout]")).map((node) => [node.dataset.twinReadout, node]));
  const equations = Object.fromEntries(Array.from(twin.querySelectorAll("[data-twin-equation]")).map((node) => [node.dataset.twinEquation, node]));
  const outputs = Object.fromEntries(Array.from(twin.querySelectorAll("[data-twin-output]")).map((node) => [node.dataset.twinOutput, node]));
  const outputCopy = Object.fromEntries(Array.from(twin.querySelectorAll("[data-twin-output-copy]")).map((node) => [node.dataset.twinOutputCopy, node]));
  const scenario = twin.querySelector("[data-twin-scenario]");
  const health = twin.querySelector("[data-twin-health]");
  const driver = twin.querySelector("[data-twin-driver]");
  const grade = twin.querySelector("[data-twin-grade]");
  const buttons = Array.from(twin.querySelectorAll("[data-twin-preset]"));
  const bound = (value, min, max) => Math.max(min, Math.min(max, value));
  const presets = {
    balanced: { label: "Balanced review", barrierEv: 3, barrierNm: 3, energyEv: 0.5, temperatureK: 300, spin: 0.72, disturbance: 0.2 },
    hot: { label: "High-temperature stress", barrierEv: 2.7, barrierNm: 2.4, energyEv: 0.68, temperatureK: 430, spin: 0.62, disturbance: 0.34 },
    attack: { label: "Disturbance attack", barrierEv: 2.35, barrierNm: 1.9, energyEv: 0.82, temperatureK: 350, spin: 0.48, disturbance: 0.72 }
  };
  const scoreModel = (state, mode) => {
    const thermalEv = 8.617e-5 * state.temperatureK;
    const effectiveBarrier = Math.max(0.02, state.barrierEv - state.energyEv);
    const kappa = 5.123 * Math.sqrt(effectiveBarrier * (mode === "nand" ? 0.6 : 3));
    const wkb = Math.exp(-2 * kappa * state.barrierNm);
    const tmr = (2 * state.spin * state.spin) / Math.max(0.03, 1 - state.spin * state.spin);
    const delta = effectiveBarrier / Math.max(thermalEv, 0.001);
    const magneticCredit = mode === "spin" ? bound(0.16 + state.spin * 0.42 + Math.log10(1 + tmr) * 0.14, 0, 0.72) : 0;
    const stress = bound((state.temperatureK - 260) / 220 + state.disturbance * 0.85 + state.energyEv / Math.max(state.barrierEv, 0.1) * 0.38, 0, 1.8);
    const suppression = bound(-Math.log10(Math.max(wkb, 1e-99)) / 38, 0, 1);
    const leak = bound((1 - suppression) * 0.58 + stress * 0.26 - magneticCredit * 0.26, 0.01, 0.99);
    const retention = bound(0.1 + bound(delta / 85, 0, 1) * 0.34 + suppression * 0.28 + magneticCredit - stress * 0.22, 0.02, 0.99);
    const read = mode === "spin" ? bound(0.18 + Math.log10(1 + tmr) * 0.34 + state.spin * 0.24 - state.disturbance * 0.16, 0.02, 0.99) : bound(0.32 + retention * 0.28 - leak * 0.22, 0.02, 0.9);
    return { wkb, tmr, delta, leak, retention, read, score: bound(retention * 0.55 + read * 0.28 + (1 - leak) * 0.17, 0, 1) };
  };
  const draw = (state, nand, spin) => {
    const scale = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * scale));
    const height = Math.max(1, Math.round(rect.height * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const w = rect.width;
    const h = rect.height;
    const light = document.body.classList.contains("light");
    const ink = light ? "#121417" : "#f3f6fb";
    const muted = light ? "rgba(34,42,52,0.72)" : "rgba(243,246,251,0.72)";
    const line = light ? "rgba(18,20,23,0.13)" : "rgba(255,255,255,0.12)";
    const colors = { cyan: "#4fd4ff", green: "#89ff9a", red: "#ff6b8d", yellow: "#ffd166" };
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = light ? "#ffffff" : "#03080c";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = line;
    for (let x = 34; x < w; x += 34) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 34; y < h; y += 34) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.fillStyle = ink;
    ctx.font = "900 18px Inter, system-ui, sans-serif";
    ctx.fillText("cell-level twin: NAND reference vs SpinVault MTJ", 24, 34);
    const panelW = (w - 72) / 2;
    const panelH = h - 96;
    const drawCell = (x, y, label, metric, accent, spinCell) => {
      ctx.fillStyle = light ? "rgba(255,255,255,0.86)" : "rgba(5,8,12,0.86)";
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.roundRect(x, y, panelW, panelH, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.font = "900 13px Inter, system-ui, sans-serif";
      ctx.fillText(label, x + 18, y + 28);
      const layers = spinCell ? ["pinned FM", "tunnel barrier", "free FM"] : ["control gate", "tunnel oxide", "stored charge"];
      layers.forEach((layer, index) => {
        const layerX = x + panelW * 0.18;
        const layerY = y + 78 + index * 54;
        ctx.fillStyle = index === 1 ? (spinCell ? "rgba(79,212,255,0.26)" : "rgba(255,209,102,0.26)") : "rgba(255,255,255,0.08)";
        ctx.strokeStyle = line;
        ctx.beginPath();
        ctx.roundRect(layerX, layerY, panelW * 0.64, 38, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = ink;
        ctx.font = "800 12px Inter, system-ui, sans-serif";
        ctx.fillText(layer, layerX + 14, layerY + 24);
      });
      const graphX = x + 18;
      const graphY = y + panelH - 150;
      const graphW = panelW - 36;
      const graphH = 94;
      ctx.strokeStyle = line;
      ctx.strokeRect(graphX, graphY, graphW, graphH);
      ctx.strokeStyle = colors.green;
      ctx.lineWidth = 3;
      ctx.beginPath();
      Array.from({ length: 40 }, (_, index) => index / 39).forEach((t, index) => {
        const retention = bound(metric.retention - t * metric.leak * 0.42 + Math.sin(t * 7 + state.disturbance * 2) * 0.025, 0, 1);
        const px = graphX + t * graphW;
        const py = graphY + (1 - retention) * graphH;
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.fillStyle = muted;
      ctx.font = "800 11px Inter, system-ui, sans-serif";
      ctx.fillText("retention forecast", graphX, graphY + graphH + 20);
      [["retention", metric.retention, colors.green], ["leak", metric.leak, colors.red], ["read", metric.read, colors.cyan]].forEach((item, index) => {
        const my = y + 50 + index * 22;
        ctx.fillStyle = muted;
        ctx.fillText(item[0], x + panelW - 146, my);
        ctx.fillStyle = line;
        ctx.fillRect(x + panelW - 78, my - 8, 54, 8);
        ctx.fillStyle = item[2];
        ctx.fillRect(x + panelW - 78, my - 8, 54 * item[1], 8);
      });
    };
    drawCell(24, 58, "Traditional NAND", nand, colors.yellow, false);
    drawCell(48 + panelW, 58, "SpinVault MTJ", spin, colors.cyan, true);
  };
  const update = () => {
    const state = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, Number(input.value)]));
    readouts.barrierEv.textContent = `${state.barrierEv.toFixed(2)} eV`;
    readouts.barrierNm.textContent = `${state.barrierNm.toFixed(2)} nm`;
    readouts.energyEv.textContent = `${state.energyEv.toFixed(2)} eV`;
    readouts.temperatureK.textContent = `${Math.round(state.temperatureK)} K`;
    readouts.spin.textContent = `${Math.round(state.spin * 100)}%`;
    readouts.disturbance.textContent = `${Math.round(state.disturbance * 100)}%`;
    const nand = scoreModel(state, "nand");
    const spin = scoreModel(state, "spin");
    const score = Math.round(spin.score * 100);
    const risk = state.temperatureK > 390 ? "thermal stress" : state.disturbance > 0.55 ? "disturbance" : spin.leak > 0.45 ? "tunnel leakage" : "readout margin";
    health.textContent = score > 74 ? "Strong" : score > 54 ? "Watch" : "Stress";
    driver.textContent = risk;
    grade.textContent = spin.score - nand.score > 0.16 ? "promising gap" : spin.score > 0.58 ? "reviewable" : "needs tuning";
    equations.leak.textContent = `T ~= ${spin.wkb.toExponential(2)}`;
    equations.tmr.textContent = `TMR ~= ${Math.round(spin.tmr * 100)}%`;
    equations.delta.textContent = `Delta ~= ${spin.delta.toFixed(1)}`;
    outputs.nand.textContent = `${Math.round(nand.score * 100)}% system score`;
    outputs.spin.textContent = `${score}% system score`;
    outputs.test.textContent = risk === "thermal stress" ? "thermal sweep" : risk === "disturbance" ? "noise sensitivity sweep" : "barrier-width sweep";
    outputCopy.nand.textContent = `Leak pressure ${Math.round(nand.leak * 100)}%, retention ${Math.round(nand.retention * 100)}%, read margin ${Math.round(nand.read * 100)}%.`;
    outputCopy.spin.textContent = `Leak pressure ${Math.round(spin.leak * 100)}%, retention ${Math.round(spin.retention * 100)}%, read margin ${Math.round(spin.read * 100)}%.`;
    outputCopy.test.textContent = "Keep this as a transparent browser estimate; the next proof step should record the chosen parameter set and compare it against advisor-reviewed assumptions.";
    draw(state, nand, spin);
  };
  const applyPreset = (name) => {
    const preset = presets[name];
    if (!preset) return;
    Object.entries(preset).forEach(([key, value]) => {
      if (inputs[key]) inputs[key].value = value;
    });
    scenario.textContent = preset.label;
    buttons.forEach((button) => {
      const active = button.dataset.twinPreset === name;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    update();
  };
  Object.values(inputs).forEach((input) => input.addEventListener("input", update));
  buttons.forEach((button) => button.addEventListener("click", () => applyPreset(button.dataset.twinPreset)));
  window.addEventListener("resize", update);
  window.addEventListener("spinvault-theme-change", update);
  update();
});
