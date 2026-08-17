/**
 * Shared flat 2D engineering layout for one SpinVault MTJ cell.
 *
 * The main map is an x-z cross-section. Layer thicknesses are deliberately
 * enlarged so the nanometre-scale stack remains readable; the scale inset
 * reports both lateral dimensions and the real z thicknesses.
 */

const LAYER_STYLE = {
  free: { fill: "#113653", edge: "#4fd4ff", ink: "#a9ebff" },
  barrier: { fill: "#302641", edge: "#c4a5ff", ink: "#eadcff" },
  reference: { fill: "#16382c", edge: "#5ddea4", ink: "#b7f0d5" }
};

const LAYER_TITLE = {
  free: "FREE MAGNETIC LAYER",
  barrier: "MgO TUNNEL BARRIER",
  reference: "PINNED / REFERENCE MAGNETIC LAYER"
};

/** @typedef {"free" | "barrier" | "reference"} LayerId */

const VARIANT_PRESETS = {
  desktop: {
    width: 960,
    height: 560,
    body: { x: 236, y: 100, w: 472, free: 120, barrier: 34, reference: 94 },
    header: { x: 24, y: 29, title: 19, subtitle: 12.5, note: 11 },
    labels: { x: 220, title: 11.5, role: 9.5 },
    panel: { x: 736, y: 100, width: 208, height: 248 },
    scale: { x: 20, y: 355, width: 200, height: 188 },
    diagnostics: { x: 236, y: 378, width: 708, line: 18, size: 12 }
  },
  compact: {
    width: 420,
    height: 560,
    body: { x: 16, y: 86, w: 388, free: 92, barrier: 27, reference: 72 },
    header: { x: 14, y: 22, title: 15, subtitle: 10.5, note: 9.2 },
    labels: null,
    panel: null,
    scale: { x: 14, y: 437, width: 392, height: 110, orientation: "horizontal" },
    diagnostics: { x: 14, y: 302, width: 392, line: 17, size: 10.5 }
  }
};

/** Scientific free-layer x–y map with MgO/reference context strips (not OVF data). */
const SCIENTIFIC_SPIN_PRESETS = {
  desktop: {
    width: 1280,
    height: 720,
    partition: { x: 0, y: 0, w: 1280, h: 720, gap: 4 },
    header: { x: 16, y: 14, title: 13, subtitle: 10, note: 9 },
    labels: { x: 84, title: 9, role: 7.2 },
    panel: { x: 1114, y: 18, width: 150, height: 156 },
    scale: { x: 92, y: 622, width: 304, height: 86, orientation: "horizontal" },
    diagnostics: { x: 410, y: 628, width: 700, line: 12, size: 9 }
  },
  compact: {
    width: 420,
    height: 560,
    partition: { x: 0, y: 0, w: 420, h: 560, gap: 3 },
    header: { x: 10, y: 16, title: 13, subtitle: 9.5, note: 8.5 },
    labels: null,
    panel: null,
    scale: { x: 10, y: 470, width: 400, height: 80, orientation: "horizontal" },
    diagnostics: { x: 10, y: 408, width: 400, line: 13, size: 9 }
  }
};

/**
 * @param {LayerId} id
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 */
function makeLayer(id, x, y, width, height) {
  return {
    id,
    x,
    y,
    w: width,
    t: height,
    width,
    height,
    right: x + width,
    bottom: y + height,
    midY: y + height / 2
  };
}

/** @param {"desktop" | "compact"} [variant] */
export function createCellLayout(variant = "desktop") {
  const key = variant === "compact" ? "compact" : "desktop";
  const preset = VARIANT_PRESETS[key];
  const b = preset.body;
  const free = makeLayer("free", b.x, b.y, b.w, b.free);
  const barrier = makeLayer("barrier", b.x, free.bottom, b.w, b.barrier);
  const reference = makeLayer("reference", b.x, barrier.bottom, b.w, b.reference);
  return {
    variant: key,
    composition: /** @type {const} */ ("cross-section"),
    width: preset.width,
    height: preset.height,
    header: preset.header,
    labels: preset.labels,
    panel: preset.panel,
    scale: preset.scale,
    diagnostics: preset.diagnostics,
    free,
    barrier,
    reference,
    bodyTop: free.y,
    bodyBottom: reference.bottom
  };
}

/**
 * Free-layer scientific x–y magnetization map with non-OVF context bands.
 * @param {"desktop" | "compact"} [variant]
 * @param {import("../lib/types").DeviceGeometry | null} [geometry]
 */
export function createScientificSpinLayout(variant = "desktop", geometry = null) {
  const key = variant === "compact" ? "compact" : "desktop";
  const preset = SCIENTIFIC_SPIN_PRESETS[key];
  const dims = geometryDimensionsNm(geometry);
  const aspect = Math.max(0.35, Math.min(3.5, dims.lateralXNm / Math.max(1e-9, dims.lateralYNm)));
  const partitionHeight = (preset.partition.h - 2 * preset.partition.gap) / 3;
  const freePartition = makeLayer(
    "free",
    preset.partition.x,
    preset.partition.y,
    preset.partition.w,
    partitionHeight
  );
  const barrier = makeLayer(
    "barrier",
    preset.partition.x,
    freePartition.bottom + preset.partition.gap,
    preset.partition.w,
    partitionHeight
  );
  const reference = makeLayer(
    "reference",
    preset.partition.x,
    barrier.bottom + preset.partition.gap,
    preset.partition.w,
    partitionHeight
  );
  // The magnetic map fills its whole partition. x and y are therefore scaled
  // independently; `footprint` records both scales so the distortion is explicit.
  const free = makeLayer(
    "free",
    freePartition.x,
    freePartition.y,
    freePartition.w,
    freePartition.t
  );
  const footprint = {
    nmPerPxX: dims.lateralXNm / free.w,
    nmPerPxY: dims.lateralYNm / free.t,
    aspectPhysical: aspect,
    aspectDrawn: free.w / free.t
  };
  return {
    variant: key,
    composition: /** @type {const} */ ("scientific-xy"),
    width: preset.width,
    height: preset.height,
    header: preset.header,
    labels: preset.labels,
    panel: preset.panel,
    scale: preset.scale,
    diagnostics: preset.diagnostics,
    free,
    freePartition,
    partitions: [freePartition, barrier, reference],
    barrier,
    reference,
    bodyTop: freePartition.y,
    bodyBottom: reference.bottom,
    cellShape: geometry?.cellShape ?? "rectangle",
    physical: dims,
    footprint
  };
}

/**
 * Shared layout contract for cross-section (wave) and scientific x–y (spin/OVF) maps.
 * @typedef {ReturnType<typeof createCellLayout> | ReturnType<typeof createScientificSpinLayout>} AnyCellLayout
 */

/** @returns {"desktop" | "compact"} */
export function pickViewportVariant() {
  if (typeof window === "undefined") return "desktop";
  // Keep in sync with simulator.css compact viewport breakpoint (@media max-width: 760px).
  return (Number(window.innerWidth) || 1440) <= 760 ? "compact" : "desktop";
}

/**
 * Bound every glyph to the smaller lattice slot. The full centered arrow is
 * shorter than one slot so neighbouring vectors never overlap.
 * @param {{ width: number, height: number, nx: number, ny: number }} input
 */
export function calculateGlyphSizing(input) {
  const nx = Math.max(1, Math.trunc(input.nx));
  const ny = Math.max(1, Math.trunc(input.ny));
  const slotW = input.width / nx;
  const slotH = input.height / ny;
  const slot = Math.min(slotW, slotH);
  return {
    slotW,
    slotH,
    slot,
    glyphRadius: Math.min(slot * 0.16, 10),
    arrowLength: Math.min(slot * 0.9, 120),
    strokeWidth: Math.min(Math.max(2.4, slot * 0.12), 6.5),
    headLength: Math.min(slot * 0.32, 22),
    headWidth: Math.min(slot * 0.2, 14),
    showArrowhead: true,
    lod: "arrow"
  };
}

/**
 * Centered magnetization arrow: shaft plus a visible triangular head.
 * `dx,dy` is the full vector from tail to tip; the glyph is centered on (cx,cy).
 * @param {SVGElement} group
 * @param {(name: string, attrs?: Record<string, string | number>) => SVGElement} el
 * @param {{
 *   cx: number,
 *   cy: number,
 *   dx: number,
 *   dy: number,
 *   color: string,
 *   sizing: ReturnType<typeof calculateGlyphSizing> | { strokeWidth: number, headLength?: number, headWidth?: number, showArrowhead?: boolean },
 *   attrs?: Record<string, string | number>
 * }} options
 */
export function appendMagnetizationArrow(group, el, options) {
  const { cx, cy, dx, dy, color, sizing } = options;
  const x1 = cx - dx / 2;
  const y1 = cy - dy / 2;
  const x2 = cx + dx / 2;
  const y2 = cy + dy / 2;
  const len = Math.hypot(dx, dy);
  const headLen = Math.min(Number(sizing.headLength) || len * 0.34, Math.max(2, len * 0.45));
  const headW = Number(sizing.headWidth) || Math.max(2.4, (Number(sizing.strokeWidth) || 2) * 1.8);
  const ux = len > 1e-6 ? dx / len : 0;
  const uy = len > 1e-6 ? dy / len : -1;
  const bx = x2 - ux * headLen;
  const by = y2 - uy * headLen;
  const px = -uy * headW;
  const py = ux * headW;
  const extra = options.attrs ?? {};
  group.append(
    el("line", {
      x1: roundLayout(x1),
      y1: roundLayout(y1),
      x2: roundLayout(sizing.showArrowhead === false ? x2 : bx),
      y2: roundLayout(sizing.showArrowhead === false ? y2 : by),
      stroke: color,
      "stroke-width": sizing.strokeWidth,
      "stroke-linecap": "round",
      "data-magnetization-arrow": "true",
      ...extra
    })
  );
  if (sizing.showArrowhead !== false) {
    group.append(
      el("polygon", {
        points: `${roundLayout(x2)},${roundLayout(y2)} ${roundLayout(bx + px)},${roundLayout(by + py)} ${roundLayout(bx - px)},${roundLayout(by - py)}`,
        fill: color,
        "data-arrowhead": "true"
      })
    );
  }
}

/** @param {number} value */
function roundLayout(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Centre of one regular cell in a flat rectangular 2D layer map.
 * @param {{x:number,y:number,w:number,t:number}} layer
 * @param {number} ix
 * @param {number} iy
 * @param {number} nx
 * @param {number} ny
 */
export function layerSlot(layer, ix, iy, nx, ny) {
  return [
    layer.x + ((ix + 0.5) / Math.max(1, nx)) * layer.w,
    layer.y + ((iy + 0.5) / Math.max(1, ny)) * layer.t
  ];
}

/**
 * Flat x-z cross-section projection. mx maps horizontally, mz vertically,
 * while my adds a bounded lateral cue; mz remains available as colour.
 * @param {{mx:number,my:number,mz:number}} vector
 * @param {number} length
 */
export function projectMagnetization2D(vector, length) {
  const x = (Number(vector.mx) || 0) + 0.35 * (Number(vector.my) || 0);
  const y = -(Number(vector.mz) || 0);
  const norm = Math.max(1, Math.hypot(x, y));
  return [(x / norm) * length, (y / norm) * length];
}

/**
 * Scientific free-layer map: arrow direction is in-plane mx/my; mz is colour only.
 * Screen y increases downward, so +my points up on the plot.
 * @param {{mx:number,my:number,mz:number}} vector
 * @param {number} length
 */
export function projectInPlaneMagnetization(vector, length) {
  return projectMagnetizationArrow(vector, length);
}

/**
 * Magnetization arrow in the device x–z plane, which contains the PMA easy axis.
 * Screen +x is device +x; screen up is device +z. Length is |m_xz| so a unit
 * vector along ±z is a full-length vertical arrow and a tilt shortens it by
 * the true projected magnitude. my is into the page in this view and is not
 * faked as a shear. Colour still tracks mz.
 *
 * @param {{mx:number,my:number,mz:number}} vector
 * @param {number} length
 */
export function projectMagnetizationArrow(vector, length) {
  const mx = Number(vector.mx) || 0;
  const mz = Number(vector.mz) || 0;
  const L = Number(length) || 0;
  return [mx * L, -mz * L];
}

/**
 * One magnetization arrow for a unit spin. Direction is the x–z projection of
 * (mx, my, mz); colour is mz. Circled-dot / circled-cross glyphs are not used.
 *
 * @param {SVGElement} group
 * @param {(name: string, attrs?: Record<string, string | number>) => SVGElement} el
 * @param {{
 *   cx: number,
 *   cy: number,
 *   spin: { mx: number, my: number, mz: number },
 *   sizing: ReturnType<typeof calculateGlyphSizing>,
 *   color?: string,
 *   attrs?: Record<string, string | number>
 * }} options
 */
export function appendSpinGlyph(group, el, options) {
  const { cx, cy, spin, sizing } = options;
  const mz = Number(spin.mz) || 0;
  const color = options.color ?? mzColor(mz);
  const extra = options.attrs ?? {};
  const [dx, dy] = projectMagnetizationArrow(spin, sizing.arrowLength);
  // m along +-y projects to zero screen length. The shaft and head nodes are
  // still emitted, only hidden, so per-frame playback can mutate them in place
  // instead of rebuilding the whole SVG when a cell passes through that state.
  const projected = Math.hypot(dx, dy) >= 1e-6;
  const glyph = el("g", {
    "data-spin-glyph": "arrow",
    "data-mz": mz.toFixed(4),
    visibility: projected ? "visible" : "hidden",
    ...extra
  });
  appendMagnetizationArrow(glyph, el, {
    cx,
    cy,
    dx: projected ? dx : 0,
    dy: projected ? dy : 0,
    color,
    sizing: { ...sizing, showArrowhead: true }
  });
  group.append(glyph);
  return glyph;
}

/**
 * Diverging mz color with a gamma-boosted ramp so a small tilt already reads as
 * color instead of neutral slate, and saturated endpoints for +-1.
 * @param {number} value
 */
export function mzColor(value) {
  const mz = Math.max(-1, Math.min(1, Number(value) || 0));
  /** @param {number} a @param {number} b @param {number} t */
  const mix = (a, b, t) => Math.round(a + (b - a) * t);
  const t = Math.pow(Math.abs(mz), 0.55);
  if (mz >= 0) {
    return `rgb(${mix(148, 255, t)}, ${mix(163, 26, t)}, ${mix(184, 26, t)})`;
  }
  return `rgb(${mix(148, 20, t)}, ${mix(163, 118, t)}, ${mix(184, 255, t)})`;
}

/**
 * 0 = poor TISE / |m| fidelity (red), 1 = residual-small / unit spin (green).
 * @param {number} value
 */
export function accuracyColor(value) {
  const a = Math.max(0, Math.min(1, Number(value) || 0));
  /** @param {number} start @param {number} end @param {number} t */
  const mix = (start, end, t) => Math.round(start + (end - start) * t);
  if (a < 0.5) {
    const t = a * 2;
    return `rgb(${mix(196, 232, t)}, ${mix(48, 196, t)}, ${mix(52, 48, t)})`;
  }
  const t = (a - 0.5) * 2;
  return `rgb(${mix(232, 46, t)}, ${mix(196, 196, t)}, ${mix(48, 120, t)})`;
}

/** @param {import("../lib/types").DeviceGeometry | null | undefined} geometry */
export function geometryDimensionsNm(geometry) {
  /**
   * @param {import("../lib/types").Quantity | null | undefined} quantity
   * @param {number} fallback
   */
  const toNm = (quantity, fallback) => {
    if (!quantity || !Number.isFinite(quantity.value)) return fallback;
    if (quantity.unit === "m") return quantity.value * 1e9;
    if (quantity.unit === "um") return quantity.value * 1e3;
    return quantity.value;
  };
  return {
    lateralXNm: toNm(geometry?.freeLayerLength, 80),
    lateralYNm: toNm(geometry?.freeLayerWidth, 40),
    freeThicknessNm: toNm(geometry?.freeLayerThickness, 1.2),
    barrierThicknessNm: toNm(geometry?.barrierThickness, 1),
    referenceThicknessNm: toNm(geometry?.referenceLayerThickness, 2.4)
  };
}

/**
 * Hard rectangular clips are the material boundaries for every mode.
 * @param {SVGElement} defs
 * @param {(name:string, attrs?:Record<string,string|number>)=>SVGElement} el
 * @param {string} prefix
 * @param {AnyCellLayout} layout
 */
export function appendLayerClips(defs, el, prefix, layout) {
  for (const layer of [layout.free, layout.barrier, layout.reference]) {
    const clip = el("clipPath", {
      id: `${prefix}-${layer.id}-clip`,
      clipPathUnits: "userSpaceOnUse"
    });
    const ellipseFree = layout.composition === "scientific-xy" && layout.cellShape === "ellipse" && layer.id === "free";
    if (ellipseFree) {
      clip.append(
        el("ellipse", {
          cx: layer.x + layer.w / 2,
          cy: layer.y + layer.t / 2,
          rx: layer.w / 2,
          ry: layer.t / 2
        })
      );
    } else {
      clip.append(el("rect", { x: layer.x, y: layer.y, width: layer.w, height: layer.t }));
    }
    defs.append(clip);
  }
}

/**
 * Flat plot patterns, colour scale, and dimension markers.
 * @param {SVGElement} defs
 * @param {(name:string, attrs?:Record<string,string|number>)=>SVGElement} el
 */
export function appendEngineeringDefs(defs, el) {
  const grid = el("pattern", {
    id: "sv-engineering-grid",
    width: 20,
    height: 20,
    patternUnits: "userSpaceOnUse"
  });
  grid.append(el("path", {
    d: "M20 0H0V20",
    fill: "none",
    stroke: "#8ca0b8",
    "stroke-width": 0.5,
    opacity: 0.13
  }));
  const mgo = el("pattern", {
    id: "sv-mgo-pattern",
    width: 8,
    height: 8,
    patternUnits: "userSpaceOnUse"
  });
  mgo.append(
    el("rect", { width: 8, height: 8, fill: LAYER_STYLE.barrier.fill }),
    el("path", { d: "M0 8L8 0M-2 2L2 -2M6 10L10 6", stroke: "#c4a5ff", "stroke-width": 0.7, opacity: 0.28 })
  );
  const mapGrid = el("pattern", {
    id: "sv-map-grid",
    width: 24,
    height: 20,
    patternUnits: "userSpaceOnUse"
  });
  mapGrid.append(el("path", {
    d: "M24 0H0V20",
    fill: "none",
    stroke: "#8dcde5",
    "stroke-width": 0.45,
    opacity: 0.17
  }));
  const mzScale = el("linearGradient", {
    id: "sv-mz-scale",
    x1: "0%",
    y1: "0%",
    x2: "100%",
    y2: "0%"
  });
  mzScale.append(
    el("stop", { offset: "0%", "stop-color": mzColor(-1) }),
    el("stop", { offset: "50%", "stop-color": mzColor(0) }),
    el("stop", { offset: "100%", "stop-color": mzColor(1) })
  );
  const dimensionArrow = el("marker", {
    id: "sv-dimension-arrow",
    viewBox: "0 0 8 8",
    refX: 4,
    refY: 4,
    markerWidth: 4,
    markerHeight: 4,
    orient: "auto-start-reverse"
  });
  dimensionArrow.append(el("path", {
    d: "M8 1L1 4L8 7",
    fill: "none",
    stroke: "#4fd4ff",
    "stroke-width": 1.2
  }));
  defs.append(grid, mgo, mapGrid, mzScale, dimensionArrow);
}

/**
 * @param {SVGElement} root
 * @param {{el:Function,text:Function,layout:AnyCellLayout,title:string,subtitle:string,note:string,noteCompact?:string}} options
 */
export function appendHeader(root, options) {
  const { el, text, layout, title, subtitle } = options;
  const h = layout.header;
  const note = layout.variant === "compact" ? options.noteCompact ?? options.note : options.note;
  root.append(
    el("rect", { x: 0, y: 0, width: layout.width, height: layout.height, fill: "#060d15" }),
    el("rect", { x: 0, y: 0, width: layout.width, height: layout.height, fill: "url(#sv-engineering-grid)" }),
    text("text", { x: h.x, y: h.y, fill: "#e8eef7", "font-size": h.title, "font-weight": 800 }, title),
    text("text", { x: h.x, y: h.y + 16, fill: "#9fb0c5", "font-size": h.subtitle, "font-weight": 600 }, subtitle)
  );
  if (note) {
    root.append(
      text("text", { x: h.x, y: h.y + 30, fill: "#7f93ab", "font-size": h.note }, note)
    );
  }
}

/**
 * Draw the shared flat cell map (cross-section for wave, scientific x–y for spin/OVF).
 * @param {SVGElement} root
 * @param {{el:Function,text:Function,layout:AnyCellLayout,mode:"spin"|"wave",roles:Record<string,string>,labels?:boolean}} options
 */
export function appendCellBody(root, options) {
  const { el, text, layout, mode, roles } = options;
  // Animated viewports stay text-free; wording lives in the surrounding HTML panels.
  const labels = options.labels === true;
  const scientific = layout.composition === "scientific-xy";
  const body = el("g", {
    class: scientific ? "sv-cell-map-scientific" : "sv-cell-map-2d",
    "data-cell-body": mode,
    "data-render-dimension": "2d",
    "data-composition": layout.composition ?? "cross-section"
  });
  if (scientific && "partitions" in layout) {
    for (const [index, partition] of layout.partitions.entries()) {
      const style = LAYER_STYLE[partition.id];
      body.append(
        el("rect", {
          x: partition.x,
          y: partition.y,
          width: partition.w,
          height: partition.t,
          fill: style.fill,
          "fill-opacity": partition.id === "free" ? 0.2 : 0.12,
          stroke: style.edge,
          "stroke-width": 1.2,
          "stroke-dasharray": partition.id === "free" ? "4 3" : "none",
          "data-equal-partition": partition.id
        })
      );
      if (labels) {
        body.append(
          text(
            "text",
            {
              x: partition.x + 10,
              y: partition.y + 16,
              fill: style.ink,
              "font-size": layout.variant === "compact" ? 8 : 10,
              "font-weight": 800
            },
            `${index + 1}/3 · ${LAYER_TITLE[partition.id]}`
          )
        );
      }
    }
  }
  for (const layer of [layout.free, layout.barrier, layout.reference]) {
    const style = LAYER_STYLE[layer.id];
    const group = el("g", {
      class: `sv-layer-band sv-layer-band-${layer.id}`,
      "data-layer": layer.id,
      ...(scientific && (layer.id === "barrier" || (mode !== "spin" && layer.id !== "free"))
        ? { "data-context-only": "true" }
        : {})
    });
    group.append(
      scientific && layer.id === "free" && layout.cellShape === "ellipse"
        ? el("ellipse", {
            cx: layer.x + layer.w / 2,
            cy: layer.y + layer.t / 2,
            rx: layer.w / 2,
            ry: layer.t / 2,
            fill: style.fill,
            stroke: style.edge,
            "stroke-width": 1.6,
            "data-face": "xy-map"
          })
        : el("rect", {
            x: layer.x,
            y: layer.y,
            width: layer.w,
            height: layer.t,
            fill: layer.id === "barrier" ? "url(#sv-mgo-pattern)" : style.fill,
            stroke: style.edge,
            "stroke-width": layer.id === "barrier" ? 1.8 : scientific && layer.id === "free" ? 1.6 : 1.2,
            "data-face": scientific && layer.id === "free" ? "xy-map" : "band"
          })
    );
    if (layer.id === "free") {
      group.append(el("rect", {
        x: layer.x,
        y: layer.y,
        width: layer.w,
        height: layer.t,
        fill: "url(#sv-map-grid)",
        "data-map-grid": layer.id
      }));
    }
    body.append(group);
  }
  if (scientific) {
    body.append(
      el("line", {
        x1: layout.free.x + 18,
        y1: layout.free.bottom - 14,
        x2: layout.free.x + 52,
        y2: layout.free.bottom - 14,
        stroke: "#ff7a90",
        "stroke-width": 1.2,
        "data-axis": "x"
      }),
      el("line", {
        x1: layout.free.x + 18,
        y1: layout.free.bottom - 14,
        x2: layout.free.x + 18,
        y2: layout.free.bottom - 42,
        stroke: "#5ec8ff",
        "stroke-width": 1.2,
        "data-axis": "y"
      })
    );
    if (labels) {
      body.append(
        text("text", {
          x: layout.free.x + 56,
          y: layout.free.bottom - 11,
          fill: "#ff7a90",
          "font-size": 9,
          "font-weight": 800
        }, "x"),
        text("text", {
          x: layout.free.x + 22,
          y: layout.free.bottom - 44,
          fill: "#5ec8ff",
          "font-size": 9,
          "font-weight": 800
        }, "y"),
        text("text", {
          x: layout.barrier.x + 8,
          y: layout.barrier.midY + 3,
          fill: "#eadcff",
          "font-size": layout.variant === "compact" ? 8 : 9,
          "font-weight": 700
        }, "NON-MAGNETIC BARRIER · no MuMax3 magnetization")
      );
    }
  } else {
    body.append(
      el("line", { x1: layout.free.x, y1: layout.barrier.y, x2: layout.free.right, y2: layout.barrier.y, stroke: "#f1f5f9", "stroke-width": 1.2 }),
      el("line", { x1: layout.free.x, y1: layout.barrier.bottom, x2: layout.free.right, y2: layout.barrier.bottom, stroke: "#f1f5f9", "stroke-width": 1.2 })
    );
  }
  root.append(body);
  if (labels) {
    appendLayerLabels(root, { el, text, layout, roles });
    if (!scientific) appendCrossSectionAxes(root, { el, text, layout });
  }
}

/**
 * @param {SVGElement} root
 * @param {{el:Function,text:Function,layout:AnyCellLayout,roles:Record<LayerId,string>}} options
 */
function appendLayerLabels(root, options) {
  const { el, text, layout, roles } = options;
  const group = el("g", { class: "sv-layer-labels" });
  for (const layer of [layout.free, layout.barrier, layout.reference]) {
    const style = LAYER_STYLE[layer.id];
    if (layout.labels) {
      const labels = layout.labels;
      const titleLines = layer.id === "reference"
        ? ["PINNED / REFERENCE", "MAGNETIC LAYER"]
        : [LAYER_TITLE[layer.id]];
      const titleStart = layer.midY - (titleLines.length - 1) * 6;
      titleLines.forEach((line, index) => {
        group.append(text("text", {
          x: labels.x,
          y: titleStart + index * 12,
          fill: style.ink,
          "font-size": labels.title,
          "font-weight": 900,
          "text-anchor": "end"
        }, line));
      });
      group.append(
        text("text", {
          x: labels.x,
          y: layer.midY + 14 + (titleLines.length - 1) * 6,
          fill: "#8fa3ba",
          "font-size": labels.role,
          "text-anchor": "end"
        }, roles[layer.id]),
        el("line", {
          x1: labels.x + 6,
          y1: layer.midY,
          x2: layer.x - 4,
          y2: layer.midY,
          stroke: style.edge,
          "stroke-width": 0.8
        })
      );
    } else {
      group.append(text("text", {
        x: layer.x + 8,
        y: layer.y + 12,
        fill: style.ink,
        "font-size": layer.id === "reference" ? 7.8 : 8.7,
        "font-weight": 900
      }, LAYER_TITLE[layer.id]));
    }
  }
  root.append(group);
}

/**
 * @param {SVGElement} root
 * @param {{el:Function,text:Function,layout:AnyCellLayout}} options
 */
function appendCrossSectionAxes(root, options) {
  const { el, text, layout } = options;
  const x = layout.free.right - 45;
  const y = layout.reference.bottom + 18;
  const axes = el("g", { class: "sv-cross-section-axes", "data-axes": "x-z" });
  axes.append(
    el("line", { x1: x, y1: y, x2: x + 34, y2: y, stroke: "#ff7a90", "stroke-width": 1.2 }),
    el("line", { x1: x, y1: y, x2: x, y2: y - 25, stroke: "#5ddea4", "stroke-width": 1.2 }),
    text("text", { x: x + 38, y: y + 3, fill: "#ff7a90", "font-size": 9, "font-weight": 800 }, "x"),
    text("text", { x: x + 4, y: y - 27, fill: "#5ddea4", "font-size": 9, "font-weight": 800 }, "z"),
    text("text", { x: x - 58, y: y + 3, fill: "#7f93ab", "font-size": 8.5 }, "2D x-z map")
  );
  root.append(axes);
}

/**
 * Bottom-left scale map comparing lateral size with the enlarged z stack.
 * @param {SVGElement} root
 * @param {{
 *   el:Function,
 *   text:Function,
 *   layout:AnyCellLayout,
 *   dimensions:ReturnType<typeof geometryDimensionsNm>,
 *   mesh?: { nx?: number, ny?: number, nz?: number, cellSizeLabel?: string, dxNm?: number, dyNm?: number, dzNm?: number }
 * }} options
 */
export function appendEngineeringScale(root, options) {
  const { el, text, layout, dimensions, mesh } = options;
  const box = layout.scale;
  const group = el("g", { class: "sv-engineering-scale", "data-scale-inset": "true" });
  group.append(
    el("rect", { x: box.x, y: box.y, width: box.width, height: box.height, rx: 5, fill: "#040a12", stroke: "#54677e", "stroke-width": 1 }),
    text("text", { x: box.x + 10, y: box.y + 16, fill: "#e8eef7", "font-size": 10, "font-weight": 900 }, "2D CELL SCALE MAP")
  );
  if ("orientation" in box && box.orientation === "horizontal") {
    appendCompactScale(group, { el, text, box, dimensions, mesh });
  } else {
    appendDesktopScale(group, { el, text, box, dimensions, mesh });
  }
  root.append(group);
}

/**
 * @param {SVGElement} group
 * @param {{el:Function,text:Function,box:{x:number,y:number,width:number,height:number},dimensions:ReturnType<typeof geometryDimensionsNm>,mesh?:{nx?:number,ny?:number,nz?:number,cellSizeLabel?:string,dxNm?:number,dyNm?:number,dzNm?:number}}} options
 */
function appendDesktopScale(group, options) {
  const { el, text, box, dimensions, mesh } = options;
  const x = box.x + 12;
  const w = box.width - 24;
  const lateralY = box.y + 36;
  group.append(
    text("text", { x, y: box.y + 28, fill: "#8fa3ba", "font-size": 8.5 }, "lateral x–y footprint"),
    el("line", { x1: x, y1: lateralY, x2: x + w, y2: lateralY, stroke: "#4fd4ff", "stroke-width": 2 }),
    el("line", { x1: x, y1: lateralY - 5, x2: x, y2: lateralY + 5, stroke: "#4fd4ff" }),
    el("line", { x1: x + w, y1: lateralY - 5, x2: x + w, y2: lateralY + 5, stroke: "#4fd4ff" }),
    text("text", { x: x + w / 2, y: lateralY + 12, fill: "#c7d4e4", "font-size": 8.5, "text-anchor": "middle" }, `${dimensions.lateralXNm.toFixed(1)} nm × ${dimensions.lateralYNm.toFixed(1)} nm`)
  );
  if (mesh?.nx && mesh?.ny) {
    const cell =
      mesh.dxNm != null && mesh.dyNm != null
        ? `${mesh.dxNm.toFixed(2)}×${mesh.dyNm.toFixed(2)} nm`
        : mesh.cellSizeLabel ?? "mesh";
    group.append(
      text(
        "text",
        { x, y: box.y + 62, fill: "#9fb0c5", "font-size": 8.2 },
        `grid ${mesh.nx}×${mesh.ny}${mesh.nz ? `×${mesh.nz}` : ""} · ${cell}`
      )
    );
  }
  group.append(text("text", { x, y: box.y + 78, fill: "#8fa3ba", "font-size": 8.5 }, "z thicknesses (physical)"));
  appendThicknessStack(group, { el, text, x, y: box.y + 84, width: 56, total: 34, fontSize: 8, dimensions });
  group.append(
    text("text", { x, y: box.y + box.height - 8, fill: "#ffd27a", "font-size": 8, "font-weight": 700 }, "z/thickness visually exaggerated")
  );
}

/**
 * @param {SVGElement} group
 * @param {{el:Function,text:Function,box:{x:number,y:number,width:number,height:number},dimensions:ReturnType<typeof geometryDimensionsNm>,mesh?:{nx?:number,ny?:number,nz?:number,cellSizeLabel?:string,dxNm?:number,dyNm?:number,dzNm?:number}}} options
 */
function appendCompactScale(group, options) {
  const { el, text, box, dimensions, mesh } = options;
  const y = box.y + 38;
  group.append(
    text("text", { x: box.x + 12, y: box.y + 30, fill: "#8fa3ba", "font-size": 8.3 }, "lateral x-y"),
    el("line", { x1: box.x + 12, y1: y, x2: box.x + 116, y2: y, stroke: "#4fd4ff", "stroke-width": 2 }),
    text("text", { x: box.x + 64, y: y + 13, fill: "#c7d4e4", "font-size": 8.3, "text-anchor": "middle" }, `${dimensions.lateralXNm.toFixed(1)} × ${dimensions.lateralYNm.toFixed(1)} nm`),
    text("text", { x: box.x + 144, y: box.y + 30, fill: "#8fa3ba", "font-size": 8.3 }, "z stack")
  );
  appendThicknessStack(group, { el, text, x: box.x + 144, y, width: 42, total: 48, fontSize: 7.8, dimensions });
  const noteX = box.x + 282;
  group.append(
    text("text", { x: noteX, y: box.y + 43, fill: "#ffd27a", "font-size": 8.2, "font-weight": 700 }, "z/thickness visually exaggerated"),
    text("text", { x: noteX, y: box.y + 57, fill: "#7f93ab", "font-size": 8.2 }, mesh?.nx ? `grid ${mesh.nx}×${mesh.ny}` : "values stay physical"),
    text("text", { x: noteX, y: box.y + 71, fill: "#7f93ab", "font-size": 8.2 }, mesh?.dxNm ? `Δx ${mesh.dxNm.toFixed(2)} nm` : "barrier ≪ lateral")
  );
}

/**
 * @param {SVGElement} group
 * @param {{el:Function,text:Function,x:number,y:number,width:number,total:number,fontSize:number,dimensions:ReturnType<typeof geometryDimensionsNm>}} options
 */
function appendThicknessStack(group, options) {
  const { el, text, x, y, width, total, fontSize, dimensions } = options;
  const items = /** @type {Array<{id:LayerId,label:string,value:number}>} */ ([
    { id: "free", label: "free", value: dimensions.freeThicknessNm },
    { id: "barrier", label: "MgO", value: dimensions.barrierThicknessNm },
    { id: "reference", label: "ref", value: dimensions.referenceThicknessNm }
  ]);
  const sum = items.reduce((acc, item) => acc + Math.max(item.value, 0.01), 0);
  let cursor = y;
  for (const item of items) {
    const style = LAYER_STYLE[item.id];
    const height = Math.max(7, (Math.max(item.value, 0.01) / sum) * total);
    group.append(
      el("rect", { x, y: cursor, width, height, fill: style.fill, stroke: style.edge, "stroke-width": 0.8 }),
      text("text", { x: x + width + 7, y: cursor + height / 2 + 3, fill: style.ink, "font-size": fontSize }, `${item.label} ${item.value.toFixed(2)} nm`)
    );
    cursor += height + 1;
  }
  group.append(el("line", {
    x1: x - 6,
    y1: y,
    x2: x - 6,
    y2: cursor - 1,
    stroke: "#4fd4ff",
    "stroke-width": 0.8,
    "marker-start": "url(#sv-dimension-arrow)",
    "marker-end": "url(#sv-dimension-arrow)"
  }));
}

/**
 * @param {SVGElement} root
 * @param {{el:Function,text:Function,layout:AnyCellLayout,lines:Array<{text:string,tone?:string}>,compactLines?:Array<{text:string,tone?:string}>}} options
 */
export function appendDiagnostics(root, options) {
  const { el, text, layout } = options;
  const box = layout.diagnostics;
  const lines = layout.variant === "compact" && options.compactLines ? options.compactLines : options.lines;
  const group = el("g", { class: "sv-viewport-diagnostics", "data-diagnostics": "true" });
  lines.forEach((line, index) => {
    const tone = line.tone ?? "normal";
    group.append(text("text", {
      x: box.x,
      y: box.y + index * box.line,
      fill: tone === "strong" ? "#e8eef7" : tone === "muted" ? "#7f93ab" : "#c7d4e4",
      "font-size": tone === "muted" ? box.size - 1 : box.size,
      "font-weight": tone === "strong" ? 800 : 500
    }, line.text));
  });
  root.append(group);
}

export { LAYER_STYLE, LAYER_TITLE };
