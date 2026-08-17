import {
  accuracyColor,
  appendCellBody,
  appendEngineeringDefs,
  appendLayerClips,
  appendSpinGlyph,
  calculateGlyphSizing,
  createScientificSpinLayout,
  layerSlot,
  mzColor
} from "./mtjViewportLayout.js";

/**
 * Map the 1D |ψ|² peak onto the scientific stack: left lead → free, barrier →
 * barrier band, right lead → reference.
 * @param {ReturnType<typeof createScientificSpinLayout>} layout
 * @param {{ peakXNm?: number, params?: { barrierThicknessNm: number } }} tunnel
 */
export function probabilityPeakPoint(layout, tunnel) {
  const dNm = Math.max(1e-9, Number(tunnel.params?.barrierThicknessNm) || 1);
  const xNm = Number(tunnel.peakXNm);
  if (!Number.isFinite(xNm) || xNm <= 0) {
    return { x: layout.free.x + layout.free.w / 2, y: layout.free.y + layout.free.t / 2 };
  }
  if (xNm >= dNm) {
    return {
      x: layout.reference.x + layout.reference.w / 2,
      y: layout.reference.y + layout.reference.t / 2
    };
  }
  const u = xNm / dNm;
  return {
    x: layout.barrier.x + u * layout.barrier.w,
    y: layout.barrier.y + layout.barrier.t / 2
  };
}

/**
 * Unit magnetization whose x–z projection points from (cx,cy) to the peak.
 * projectMagnetizationArrow maps mx to screen +x and mz to screen up.
 * @param {number} cx
 * @param {number} cy
 * @param {{x:number,y:number}} peak
 */
export function spinTowardPeak(cx, cy, peak) {
  const vx = peak.x - cx;
  const vy = peak.y - cy;
  const n = Math.hypot(vx, vy);
  if (n < 1e-6) return { mx: 0, my: 0, mz: 1 };
  return { mx: vx / n, my: 0, mz: -vy / n };
}

/**
 * Numerical fidelity of one magnetization vector: |m| must stay 1 under LLG.
 * @param {{ mx?: number, my?: number, mz?: number }} spin
 */
export function spinAccuracy(spin) {
  const mag = Math.hypot(Number(spin.mx) || 0, Number(spin.my) || 0, Number(spin.mz) || 0);
  return Math.max(0, Math.min(1, 1 - Math.abs(1 - mag)));
}

/**
 * @param {{ mx?: number, my?: number, mz?: number }} spin
 * @param {number | undefined} waveAccuracy
 */
function resolveAccuracy(spin, waveAccuracy) {
  const fidelity = spinAccuracy(spin);
  return Number.isFinite(waveAccuracy)
    ? Math.min(fidelity, /** @type {number} */ (waveAccuracy))
    : fidelity;
}

/**
 * Text-free pre-run magnetization map for the free and pinned magnetic layers.
 * Every label, number, and provenance statement is rendered in the surrounding
 * HTML board instead, so the viewport stays a clean visualization.
 *
 * @param {SVGSVGElement} svg
 * @param {ReturnType<import("../lib/spinCellModel").buildSpinCellField>} field
 * @param {{
 *   title?: string,
 *   variant?: "desktop" | "compact",
 *   geometry?: import("../lib/types").DeviceGeometry,
 *   probabilityPeak?: { x: number, y: number } | null,
 *   waveAccuracy?: number
 * }} [options]
 */
export function renderSpinView(svg, field, options = {}) {
  const layout = createScientificSpinLayout(options.variant, options.geometry ?? null);
  svg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `SpinVault MTJ magnetic-layer spin map. ${field.convention} ${field.honesty}`
  );
  svg.replaceChildren();

  const NS = "http://www.w3.org/2000/svg";
  /**
   * @param {string} name
   * @param {Record<string, string | number>} attrs
   */
  const el = (name, attrs = {}) => {
    const node = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  };
  /**
   * @param {string} name
   * @param {Record<string, string | number>} attrs
   * @param {string} content
   */
  const text = (name, attrs, content) => {
    const node = el(name, attrs);
    node.textContent = content;
    return node;
  };

  const defs = el("defs");
  appendEngineeringDefs(defs, el);
  appendLayerClips(defs, el, "sv-spin", layout);

  const peak = options.probabilityPeak ?? null;
  const root = el("g", {
    class: "sv-spin-field",
    "data-view-variant": layout.variant,
    "data-spin-signature": spinSignature(field, layout.variant, Boolean(peak))
  });
  appendCellBody(root, {
    el,
    text,
    layout,
    mode: "spin",
    roles: {
      free: "free-layer x–y map",
      barrier: "non-magnetic",
      reference: "pinned reference x–y map"
    }
  });

  if (peak) {
    root.append(
      el("circle", {
        cx: peak.x,
        cy: peak.y,
        r: 7,
        fill: "#fff4c4",
        "fill-opacity": 0.9,
        "data-probability-peak": "true"
      })
    );
  }

  /**
   * @param {{ x: number, y: number, w: number, t: number, id: string }} layer
   * @param {"free" | "reference"} layerId
   * @param {number} rows
   * @param {string} clipId
   */
  const drawLayer = (layer, layerId, rows, clipId) => {
    const sizing = calculateGlyphSizing({
      width: layer.w,
      height: layer.t,
      nx: field.nx,
      ny: rows
    });
    const group = el("g", {
      class: `sv-${layerId}-spin-glyphs`,
      "data-spin-layer": layerId,
      "clip-path": `url(#${clipId})`
    });
    // The reference layer is pinned, so only the free layer is redirected.
    const layerPeak = layerId === "free" ? peak : null;
    for (const spin of field.spins) {
      if (spin.layer !== layerId) continue;
      const [cx, cy] = layerSlot(layer, spin.ix, spin.iy, field.nx, rows);
      const directed = layerPeak ? spinTowardPeak(cx, cy, layerPeak) : spin;
      const accuracy = resolveAccuracy(spin, Number(options.waveAccuracy));
      appendSpinGlyph(group, el, {
        cx,
        cy,
        spin: directed,
        sizing,
        color: layerPeak ? accuracyColor(accuracy) : mzColor(spin.mz),
        attrs: {
          "data-cell": `${spin.ix},${spin.iy}`,
          "data-accuracy": accuracy.toFixed(4)
        }
      });
    }
    root.append(group);
  };

  drawLayer(layout.free, "free", field.freeRows, "sv-spin-free-clip");
  drawLayer(layout.reference, "reference", field.referenceRows, "sv-spin-reference-clip");

  svg.append(defs, root);
}

/**
 * Mutate existing glyphs when the lattice is unchanged so playback does not
 * rebuild the whole SVG tree every frame.
 * @param {SVGSVGElement} svg
 * @param {ReturnType<import("../lib/spinCellModel").buildSpinCellField>} field
 * @param {Parameters<typeof renderSpinView>[2]} [options]
 */
export function updateSpinView(svg, field, options = {}) {
  const layout = createScientificSpinLayout(options.variant, options.geometry ?? null);
  const peak = options.probabilityPeak ?? null;
  const root = svg.querySelector(".sv-spin-field");
  const signature = spinSignature(field, layout.variant, Boolean(peak));
  if (!(root instanceof SVGElement) || root.getAttribute("data-spin-signature") !== signature) {
    renderSpinView(svg, field, options);
    return;
  }
  const peakDot = svg.querySelector("[data-probability-peak='true']");
  if (peak && peakDot) {
    peakDot.setAttribute("cx", String(peak.x));
    peakDot.setAttribute("cy", String(peak.y));
  }
  /**
   * @param {"free" | "reference"} layerId
   * @param {{ x: number, y: number, w: number, t: number }} layer
   * @param {number} rows
   */
  const updateLayer = (layerId, layer, rows) => {
    const sizing = calculateGlyphSizing({
      width: layer.w,
      height: layer.t,
      nx: field.nx,
      ny: rows
    });
    const layerPeak = layerId === "free" ? peak : null;
    for (const spin of field.spins) {
      if (spin.layer !== layerId) continue;
      const group = svg.querySelector(
        `[data-spin-layer="${layerId}"] [data-cell="${spin.ix},${spin.iy}"]`
      );
      if (!group) continue;
      const [cx, cy] = layerSlot(layer, spin.ix, spin.iy, field.nx, rows);
      const directed = layerPeak ? spinTowardPeak(cx, cy, layerPeak) : spin;
      const accuracy = resolveAccuracy(spin, Number(options.waveAccuracy));
      const color = layerPeak ? accuracyColor(accuracy) : mzColor(spin.mz);
      const [dx, dy] = [
        (Number(directed.mx) || 0) * sizing.arrowLength,
        -(Number(directed.mz) || 0) * sizing.arrowLength
      ];
      const line = group.querySelector("[data-magnetization-arrow='true']");
      const head = group.querySelector("[data-arrowhead='true']");
      if (!line) continue;
      const x1 = cx - dx / 2;
      const y1 = cy - dy / 2;
      const x2 = cx + dx / 2;
      const y2 = cy + dy / 2;
      const len = Math.hypot(dx, dy);
      group.setAttribute("visibility", len >= 1e-6 ? "visible" : "hidden");
      const headLen = Math.min(sizing.headLength, Math.max(2, len * 0.45));
      const ux = len > 1e-6 ? dx / len : 0;
      const uy = len > 1e-6 ? dy / len : -1;
      const bx = x2 - ux * headLen;
      const by = y2 - uy * headLen;
      const px = -uy * sizing.headWidth;
      const py = ux * sizing.headWidth;
      line.setAttribute("x1", String(Math.round(x1 * 100) / 100));
      line.setAttribute("y1", String(Math.round(y1 * 100) / 100));
      line.setAttribute("x2", String(Math.round(bx * 100) / 100));
      line.setAttribute("y2", String(Math.round(by * 100) / 100));
      line.setAttribute("stroke", color);
      if (head) {
        head.setAttribute(
          "points",
          `${Math.round(x2 * 100) / 100},${Math.round(y2 * 100) / 100} ${Math.round((bx + px) * 100) / 100},${Math.round((by + py) * 100) / 100} ${Math.round((bx - px) * 100) / 100},${Math.round((by - py) * 100) / 100}`
        );
        head.setAttribute("fill", color);
      }
      group.setAttribute("data-accuracy", accuracy.toFixed(4));
      group.setAttribute("data-mz", (Number(directed.mz) || 0).toFixed(4));
    }
  };
  updateLayer("free", layout.free, field.freeRows);
  updateLayer("reference", layout.reference, field.referenceRows);
}

/**
 * @param {ReturnType<import("../lib/spinCellModel").buildSpinCellField>} field
 * @param {string} variant
 * @param {boolean} towardPeak
 */
function spinSignature(field, variant, towardPeak) {
  return `${variant}|${field.nx}|${field.freeRows}|${field.referenceRows}|${towardPeak ? "peak" : "m"}`;
}
