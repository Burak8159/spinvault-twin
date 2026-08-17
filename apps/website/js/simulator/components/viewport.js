import { getMaterialPreset } from "../lib/defaults.js";
import { formatQuantity } from "../lib/units.js";
import {
  appendCellBody,
  appendDiagnostics,
  appendEngineeringDefs,
  appendEngineeringScale,
  appendHeader,
  appendLayerClips,
  appendMagnetizationArrow,
  appendSpinGlyph,
  calculateGlyphSizing,
  createScientificSpinLayout,
  geometryDimensionsNm,
  layerSlot,
  mzColor
} from "./mtjViewportLayout.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * @param {string} name
 * @param {Record<string, string | number>} [attrs]
 */
function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value));
  }
  return node;
}

/**
 * @param {string} name
 * @param {Record<string, string | number>} attrs
 * @param {string} text
 */
function textEl(name, attrs, text) {
  const node = el(name, attrs);
  node.textContent = text;
  return node;
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Deterministic stack schematic driven by typed scenario state.
 * This is a drawing, not a field solution.
 *
 * @param {SVGSVGElement} svg
 * @param {import("../lib/types").SimulatorState} state
 */
export function renderDeviceViewport(svg, state) {
  const { geometry, materials, controls } = state;
  const zoom = clamp(controls.viewportZoom || 1, 0.7, 1.8);
  const width = 720;
  const height = 420;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `Device schematic: ${geometry.cellShape} stack with free, barrier, and reference layers. Demo drawing only.`
  );
  svg.replaceChildren();

  const defs = el("defs");
  const grid = el("pattern", {
    id: "sv-grid",
    width: 18,
    height: 18,
    patternUnits: "userSpaceOnUse"
  });
  grid.append(
    el("path", {
      d: "M 18 0 L 0 0 0 18",
      fill: "none",
      stroke: "currentColor",
      "stroke-opacity": "0.12"
    })
  );
  const currentMarker = el("marker", {
    id: "sv-arrow",
    viewBox: "0 0 10 10",
    refX: 8,
    refY: 5,
    markerWidth: 6,
    markerHeight: 6,
    orient: "auto-start-reverse"
  });
  currentMarker.append(el("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#4fd4ff" }));
  const axisMarker = el("marker", {
    id: "sv-axis",
    viewBox: "0 0 10 10",
    refX: 8,
    refY: 5,
    markerWidth: 5,
    markerHeight: 5,
    orient: "auto"
  });
  axisMarker.append(el("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "currentColor" }));
  defs.append(grid, currentMarker, axisMarker);

  const root = el("g", { transform: `translate(${width / 2} ${height / 2}) scale(${zoom})` });
  const thicknesses = [
    geometry.freeLayerThickness.value,
    geometry.barrierThickness.value,
    geometry.referenceLayerThickness.value
  ];
  const totalThickness = thicknesses.reduce((sum, value) => sum + Math.max(value, 0.01), 0);
  const stackHeight = 168;
  const lengthRatio = clamp(geometry.freeLayerLength.value / 120, 0.45, 2.2);
  const widthRatio = clamp(geometry.freeLayerWidth.value / 60, 0.4, 1.8);
  const bodyWidth = 210 * widthRatio;
  const isTrack = geometry.cellShape === "nanowire";
  const rx = geometry.cellShape === "ellipse" ? bodyWidth / 2 : isTrack ? 10 : 8;

  const layers = [
    {
      id: /** @type {const} */ ("reference"),
      label: "Reference layer",
      material: getMaterialPreset(materials.referenceLayerId),
      thickness: geometry.referenceLayerThickness,
      fill: "rgba(137, 255, 154, 0.28)",
      stroke: "#89ff9a"
    },
    {
      id: /** @type {const} */ ("barrier"),
      label: "Spacer / barrier",
      material: getMaterialPreset(materials.barrierId),
      thickness: geometry.barrierThickness,
      fill: "rgba(255, 209, 102, 0.28)",
      stroke: "#ffd166"
    },
    {
      id: /** @type {const} */ ("free"),
      label: "Magnetic layer",
      material: getMaterialPreset(materials.freeLayerId),
      thickness: geometry.freeLayerThickness,
      fill: "rgba(79, 212, 255, 0.3)",
      stroke: "#4fd4ff"
    }
  ];

  let cursor = stackHeight / 2;
  const stack = el("g", { class: "sv-stack", transform: "translate(20 8)" });
  for (const layer of layers) {
    const share = Math.max(layer.thickness.value, 0.01) / totalThickness;
    const layerHeight = Math.max(18, share * stackHeight);
    cursor -= layerHeight;
    const y = cursor;
    const selected = controls.selectedRegion === layer.id;
    const group = el("g", {
      class: selected ? "sv-layer is-selected" : "sv-layer",
      "data-region": layer.id
    });
    const shapeWidth = isTrack && layer.id === "free" ? bodyWidth * 1.35 : bodyWidth;
    group.append(
      el("rect", {
        x: -shapeWidth / 2,
        y,
        width: shapeWidth,
        height: layerHeight,
        rx: layer.id === "barrier" ? 4 : Math.min(12, rx / 6),
        fill: layer.fill,
        stroke: layer.stroke,
        "stroke-width": selected ? 3 : 1.2
      }),
      textEl(
        "text",
        {
          x: -shapeWidth / 2 + 10,
          y: y + Math.min(18, layerHeight - 4),
          fill: "currentColor",
          "font-size": 11,
          "font-weight": 700
        },
        `${layer.label} · ${layer.material?.label ?? "unselected"} · ${formatQuantity(layer.thickness)}`
      )
    );
    stack.append(group);
  }

  const currentY0 = controls.currentDirection === "positive_z" ? 110 : -130;
  const currentY1 = controls.currentDirection === "positive_z" ? -130 : 110;
  const current = el("g", { class: "sv-current" });
  current.append(
    el("line", {
      x1: -bodyWidth / 2 - 48,
      y1: currentY0,
      x2: -bodyWidth / 2 - 48,
      y2: currentY1,
      stroke: "#4fd4ff",
      "stroke-width": 2,
      "marker-end": "url(#sv-arrow)"
    }),
    textEl(
      "text",
      {
        x: -bodyWidth / 2 - 74,
        y: -8,
        fill: "currentColor",
        "font-size": 11,
        "font-weight": 700,
        transform: `rotate(-90 ${-bodyWidth / 2 - 74} -8)`
      },
      "I (demo)"
    )
  );

  const initial = state.initialMagnetization.vector;
  const magnetization = el("g", { class: "sv-initial-vector", transform: "translate(20 -112)" });
  if (initial) {
    const vectorScale = 48;
    magnetization.append(
      el("line", {
        x1: 0,
        y1: 0,
        x2: initial.x * vectorScale + initial.z * 16,
        y2: -initial.y * vectorScale - initial.z * 34,
        stroke: "#ff6f8f",
        "stroke-width": 3,
        "marker-end": "url(#sv-arrow)"
      }),
      textEl(
        "text",
        { x: 10, y: -44, fill: "currentColor", "font-size": 11, "font-weight": 700 },
        `m₀ [${initial.x}, ${initial.y}, ${initial.z}] · draft`
      )
    );
  }

  const axes = el("g", { class: "sv-axes", transform: "translate(-300 140)" });
  axes.append(
    el("line", { x1: 0, y1: 0, x2: 64, y2: 0, stroke: "currentColor", "stroke-width": 1.4, "marker-end": "url(#sv-axis)" }),
    el("line", { x1: 0, y1: 0, x2: 0, y2: -64, stroke: "currentColor", "stroke-width": 1.4, "marker-end": "url(#sv-axis)" }),
    el("line", { x1: 0, y1: 0, x2: 28, y2: 28, stroke: "currentColor", "stroke-width": 1.4, "marker-end": "url(#sv-axis)" }),
    textEl("text", { x: 70, y: 4, fill: "currentColor", "font-size": 11, "font-weight": 700 }, "x"),
    textEl("text", { x: 4, y: -70, fill: "currentColor", "font-size": 11, "font-weight": 700 }, "y"),
    textEl("text", { x: 32, y: 42, fill: "currentColor", "font-size": 11, "font-weight": 700 }, "z")
  );

  const footprint = el("g", { class: "sv-footprint", transform: "translate(250 -120)" });
  const fpW = 88 * widthRatio;
  const fpH = geometry.cellShape === "nanowire" ? 28 : 56 * Math.min(lengthRatio, 1.4);
  if (geometry.cellShape === "ellipse") {
    footprint.append(
      el("ellipse", {
        cx: 0,
        cy: 0,
        rx: fpW / 2,
        ry: fpH / 2,
        fill: "rgba(79, 212, 255, 0.12)",
        stroke: "#4fd4ff"
      })
    );
  } else {
    footprint.append(
      el("rect", {
        x: -fpW / 2,
        y: -fpH / 2,
        width: fpW,
        height: geometry.cellShape === "nanowire" ? 22 : fpH,
        rx: geometry.cellShape === "nanowire" ? 11 : 6,
        fill: "rgba(79, 212, 255, 0.12)",
        stroke: "#4fd4ff"
      })
    );
  }
  footprint.append(
    textEl(
      "text",
      { x: 0, y: fpH / 2 + 18, fill: "currentColor", "font-size": 11, "font-weight": 700, "text-anchor": "middle" },
      `Top view · ${geometry.cellShape}`
    )
  );

  root.append(
    stack,
    current,
    magnetization,
    axes,
    footprint,
    textEl(
      "text",
      {
        x: -width / 2 + 24,
        y: -height / 2 + 28,
        fill: "currentColor",
        "font-size": 12,
        "font-weight": 800
      },
      `Schematic viewport · demo drawing · Bext [${state.externalField.x.value}, ${state.externalField.y.value}, ${state.externalField.z.value}] T`
    )
  );

  svg.append(
    defs,
    el("rect", { x: 0, y: 0, width, height, fill: "url(#sv-grid)", color: "currentColor" }),
    root
  );
}

/**
 * Draw the currently selected raw table sample over the schematic.
 * @param {SVGSVGElement} svg
 * @param {{ mx: number, my: number, mz: number } | null} vector
 */
export function renderPlaybackVector(svg, vector) {
  svg.querySelector("[data-playback-vector]")?.remove();
  if (!vector) return;
  const group = el("g", {
    "data-playback-vector": "true",
    transform: "translate(380 118)"
  });
  const scale = 72;
  group.append(
    el("circle", {
      cx: 0,
      cy: 0,
      r: 6,
      fill: "#ff6f8f"
    }),
    el("line", {
      x1: 0,
      y1: 0,
      x2: vector.mx * scale + vector.mz * 24,
      y2: -vector.my * scale - vector.mz * 52,
      stroke: "#ff6f8f",
      "stroke-width": 5,
      "stroke-linecap": "round",
      "marker-end": "url(#sv-arrow)"
    }),
    textEl(
      "text",
      { x: -70, y: -82, fill: "currentColor", "font-size": 12, "font-weight": 800 },
      "Raw MuMax3 m(t)"
    )
  );
  svg.append(group);
}

/**
 * Choose a sparse display lattice from the viewport size. Raw OVF stays 64×32×1;
 * only the drawn quiver is downsampled.
 * @param {string} [variant]
 * @param {number} [width]
 * @param {number} [height]
 */
export function pickOvfDisplayLattice(variant = "desktop", width = 980, height = 490) {
  const budget = variant === "compact" || width < 480 ? 32 : width < 820 ? 72 : 128;
  // Split the glyph budget along the drawn aspect ratio so display slots stay
  // near-square and each arrow can use as much of its slot as possible.
  const aspect = Math.max(0.2, Math.min(12, width / Math.max(1, height)));
  const ny = Math.max(2, Math.round(Math.sqrt(budget / aspect)));
  const nx = Math.max(2, Math.round(budget / ny));
  return { nx, ny };
}

/**
 * Aggregate raw OVF cells into a fixed display lattice without spatial interpolation.
 * Every displayed vector is the arithmetic mean of raw vectors in one non-overlapping bin.
 *
 * @param {import("../lib/types").OvfFrameVector[]} vectors
 * @param {{ nx: number, ny: number, activeZ: number, targetNx: number, targetNy: number, activeFloor?: number }} options
 */
export function downsampleOvfVectors(vectors, options) {
  const displayNx = Math.max(1, Math.min(options.nx, Math.trunc(options.targetNx)));
  const displayNy = Math.max(1, Math.min(options.ny, Math.trunc(options.targetNy)));
  const floor = options.activeFloor ?? 0.05;
  /** @type {Map<string, {mx:number,my:number,mz:number,magnitude:number,count:number,ix:number,iy:number,xMeters:number,yMeters:number}>} */
  const bins = new Map();
  for (const vector of vectors) {
    if (vector.z !== options.activeZ || vector.x < 0 || vector.y < 0) continue;
    const magnitude = vector.magnitude || Math.hypot(vector.mx, vector.my, vector.mz);
    if (magnitude < floor) continue;
    const ix = Math.min(displayNx - 1, Math.floor((vector.x / options.nx) * displayNx));
    const iy = Math.min(displayNy - 1, Math.floor((vector.y / options.ny) * displayNy));
    const key = `${ix}:${iy}`;
    const bin = bins.get(key) ?? { mx: 0, my: 0, mz: 0, magnitude: 0, count: 0, ix, iy, xMeters: 0, yMeters: 0 };
    bin.mx += vector.mx;
    bin.my += vector.my;
    bin.mz += vector.mz;
    bin.magnitude += vector.magnitude;
    bin.xMeters += Number(vector.xMeters) || 0;
    bin.yMeters += Number(vector.yMeters) || 0;
    bin.count += 1;
    bins.set(key, bin);
  }
  return {
    nx: displayNx,
    ny: displayNy,
    vectors: [...bins.values()].map((bin) => ({
      index: bin.iy * displayNx + bin.ix,
      x: bin.ix,
      y: bin.iy,
      z: options.activeZ,
      mx: bin.mx / bin.count,
      my: bin.my / bin.count,
      mz: bin.mz / bin.count,
      magnitude: bin.magnitude / bin.count,
      sourceCount: bin.count,
      xMeters: bin.xMeters / bin.count,
      yMeters: bin.yMeters / bin.count
    }))
  };
}

/**
 * One canvas image for the raw mz (or mx/my) colormap. Display-only; arrows stay SVG.
 * @param {import("../lib/types").OvfFrameVector[]} vectors
 * @param {number} nx
 * @param {number} ny
 * @param {number} activeZ
 * @param {{x:number,y:number,w:number,t:number}} free
 * @param {string} [mode]
 */
function paintOvfColormapImage(vectors, nx, ny, activeZ, free, mode = "vector") {
  if (typeof document === "undefined" || typeof document.createElement !== "function") return null;
  let canvas;
  try {
    canvas = document.createElement("canvas");
  } catch {
    return null;
  }
  if (!canvas || typeof canvas.getContext !== "function") return null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  canvas.width = nx;
  canvas.height = ny;
  const image = ctx.createImageData(nx, ny);
  const channel = mode === "mx" ? "mx" : mode === "my" ? "my" : "mz";
  const byIndex = new Map();
  for (const vector of vectors) {
    if (vector.z !== activeZ) continue;
    byIndex.set(vector.y * nx + vector.x, vector);
  }
  for (let y = 0; y < ny; y += 1) {
    for (let x = 0; x < nx; x += 1) {
      const vector = byIndex.get(y * nx + x);
      const offset = (y * nx + x) * 4;
      const magnitude = vector ? vector.magnitude || Math.hypot(vector.mx, vector.my, vector.mz) : 0;
      if (!vector || magnitude < 0.05) {
        image.data[offset + 3] = 0;
        continue;
      }
      const color = mzColor(Number(vector[channel]) || 0);
      const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      image.data[offset] = match ? Number(match[1]) : 148;
      image.data[offset + 1] = match ? Number(match[2]) : 163;
      image.data[offset + 2] = match ? Number(match[3]) : 184;
      image.data[offset + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  let href = "";
  try {
    href = canvas.toDataURL("image/png");
  } catch {
    return null;
  }
  if (!href) return null;
  return el("image", {
    href,
    x: free.x,
    y: free.y,
    width: free.w,
    height: free.t,
    preserveAspectRatio: "none",
    "data-ovf-colormap": "true",
    "data-display-downsampled": "false",
    "data-raw-grid-hint": "true",
    opacity: 0.28
  });
}

/**
 * Draw one raw MuMax3 OVF frame as a scientific free-layer x–y map.
 * No smoothing or interpolation is applied; each rendered cell maps to one OVF vector row.
 *
 * @param {SVGSVGElement} svg
 * @param {import("../lib/types").OvfFrameData | null} frame
 * @param {{
 *   meanMx?: number,
 *   meanMy?: number,
 *   meanMz?: number,
 *   maxFrameDelta?: number | null,
 *   timeLabel?: string,
 *   staticAtPrecision?: boolean,
 *   geometry?: import("../lib/types").DeviceGeometry,
 *   variant?: "desktop" | "compact",
 *   switchingThreshold?: number | null,
 *   finalAlignmentState?: string | null,
 *   switchingOccurred?: string | null,
 *   meshCellSizeLabel?: string | null,
 *   framePosition?: string,
 *   previousFrame?: import("../lib/types").OvfFrameData | null,
 *   deltaOverlay?: boolean,
 *   displayMode?: "vector" | "mz" | "mx" | "my"
 * }} [diagnostics]
 */
export function renderOvfFrameViewport(svg, frame, diagnostics = {}) {
  if (!frame?.vectors?.length) {
    renderOvfFrameErrorViewport(
      svg,
      "OVF frame response did not include raw cell vectors.",
      diagnostics.geometry ?? null,
      diagnostics.variant
    );
    return;
  }

  const layout = createScientificSpinLayout(diagnostics.variant, diagnostics.geometry ?? null);
  svg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `Raw MuMax3 OVF frame ${frame.index}: free-layer magnetization map from ${frame.path}.`
  );
  svg.replaceChildren();

  const defs = el("defs");
  appendEngineeringDefs(defs, el);
  appendLayerClips(defs, el, "sv-ovf", layout);

  const metadata = frame.metadata ?? {};
  const nx = Math.max(1, Number(metadata.xnodes) || Math.max(...frame.vectors.map((vector) => vector.x)) + 1);
  const ny = Math.max(1, Number(metadata.ynodes) || Math.max(...frame.vectors.map((vector) => vector.y)) + 1);
  const nz = Math.max(1, Number(metadata.znodes) || Math.max(...frame.vectors.map((vector) => vector.z)) + 1);
  const activeZ = Math.min(...frame.vectors.map((vector) => vector.z));
  const visibleVectors = frame.vectors.filter((vector) => vector.z === activeZ);
  const target = pickOvfDisplayLattice(layout.variant, layout.free.w, layout.free.t);
  const display = downsampleOvfVectors(visibleVectors, {
    nx,
    ny,
    activeZ,
    targetNx: target.nx,
    targetNy: target.ny
  });
  const previousDisplay = diagnostics.previousFrame?.vectors?.length
    ? downsampleOvfVectors(diagnostics.previousFrame.vectors, {
        nx,
        ny,
        activeZ,
        targetNx: target.nx,
        targetNy: target.ny
      })
    : null;
  const meanMz = Number(diagnostics.meanMz ?? 0);
  const previousByIndex = new Map((previousDisplay?.vectors ?? []).map((vector) => [vector.index, vector]));

  const root = el("g", {
    class: "sv-ovf-field",
    "data-view-variant": layout.variant,
    "data-composition": "scientific-xy"
  });
  appendCellBody(root, {
    el,
    text: textEl,
    layout,
    mode: "spin",
    roles: {
      free: "MuMax3 OVF",
      barrier: "context only",
      reference: "context · pinned +z"
    }
  });

  const free = layout.free;
  const sizing = calculateGlyphSizing({
    width: free.w,
    height: free.t,
    nx: display.nx,
    ny: display.ny
  });
  const field = el("g", {
    class: "sv-ovf-cell-vectors",
    "data-cell-layer": "free",
    "data-source": "mumax3-ovf",
    "data-lod": sizing.lod,
    "data-display-downsampled": "true",
    "data-display-nx": display.nx,
    "data-display-ny": display.ny,
    "data-raw-nx": nx,
    "data-raw-ny": ny,
    "data-display-vector-count": display.vectors.length,
    "clip-path": "url(#sv-ovf-free-clip)"
  });
  const colormap = paintOvfColormapImage(visibleVectors, nx, ny, activeZ, free, diagnostics.displayMode ?? "vector");
  if (colormap) field.append(colormap);
  const colorMode = diagnostics.displayMode === "mx" ? "mx" : diagnostics.displayMode === "my" ? "my" : "mz";
  const showArrows = diagnostics.displayMode !== "mz";

  for (const vector of display.vectors) {
    const [cx, cy] = layerSlot(free, vector.x, vector.y, display.nx, display.ny);
    const colorValue = colorMode === "mx" ? vector.mx : colorMode === "my" ? vector.my : vector.mz;
    const color = mzColor(colorValue);
    const previous = previousByIndex.get(vector.index);
    const delta = previous
      ? Math.hypot(vector.mx - previous.mx, vector.my - previous.my, vector.mz - previous.mz)
      : 0;
    const xMeters = Number(vector.xMeters);
    const yMeters = Number(vector.yMeters);
    const xNm = Number.isFinite(xMeters) ? xMeters * 1e9 : null;
    const yNm = Number.isFinite(yMeters) ? yMeters * 1e9 : null;
    const inspect =
      `m=(${vector.mx.toFixed(3)}, ${vector.my.toFixed(3)}, ${vector.mz.toFixed(3)})` +
      (xNm != null && yNm != null ? ` · x=${xNm.toFixed(2)} nm y=${yNm.toFixed(2)} nm` : ` · cell (${vector.x},${vector.y})`);
    if (diagnostics.deltaOverlay && delta > 1e-7) {
      field.append(
        el("circle", {
          cx: roundNumber(cx),
          cy: roundNumber(cy),
          r: sizing.glyphRadius + 4,
          fill: "none",
          stroke: "#fff176",
          "stroke-width": clamp(delta * 8, 0.9, 2.6),
          opacity: 0.85,
          "data-delta-m": delta.toExponential(3)
        })
      );
    }
    if (showArrows) {
      appendSpinGlyph(field, el, {
        cx,
        cy,
        spin: vector,
        sizing,
        color,
        attrs: {
          "data-cell-vector": vector.index,
          "data-in-plane-vector": vector.index,
          "data-raw-cell-count": vector.sourceCount,
          title: inspect
        }
      });
    } else {
      field.append(
        el("circle", {
          cx: roundNumber(cx),
          cy: roundNumber(cy),
          r: Math.max(1.6, sizing.glyphRadius * 0.55),
          fill: color,
          opacity: 0.95,
          "data-cell-vector": vector.index,
          "data-raw-cell-count": vector.sourceCount,
          title: inspect
        })
      );
    }
  }
  root.append(field);
  appendPinnedReferenceArrows(root, layout, el);
  root.setAttribute("data-mean-mz", meanMz.toFixed(6));

  svg.append(defs, root);
}

/**
 * Static reference-layer arrows are visual stack context, not MuMax3 output.
 * @param {SVGElement} root
 * @param {ReturnType<typeof createScientificSpinLayout>} layout
 * @param {(name: string, attrs?: Record<string, string | number>) => SVGElement} el
 */
function appendPinnedReferenceArrows(root, layout, el) {
  const group = el("g", {
    "data-layer-context": "pinned-reference",
    "aria-label": "Static pinned reference context, not MuMax3 output"
  });
  const count = layout.variant === "compact" ? 6 : 8;
  const y = layout.reference.midY;
  const slot = layout.reference.w / count;
  const arrowH = Math.min(18, layout.reference.t * 0.62);
  const sizing = {
    strokeWidth: 2.6,
    headLength: 7,
    headWidth: 5.5,
    showArrowhead: true
  };
  for (let index = 0; index < count; index += 1) {
    const cx = layout.reference.x + slot * (index + 0.5);
    appendMagnetizationArrow(group, el, {
      cx,
      cy: y,
      dx: 0,
      dy: -arrowH,
      color: mzColor(1),
      sizing,
      attrs: { "data-reference-arrow": String(index) }
    });
  }
  root.append(group);
}

/** @param {number} value */
function roundNumber(value) {
  return Math.round(value * 100) / 100;
}

/**
 * @param {SVGElement} root
 * @param {ReturnType<typeof createScientificSpinLayout>} layout
 * @param {string} grid
 * @param {{ maxFrameDelta?: number | null, staticAtPrecision?: boolean, deltaOverlay?: boolean, switchingOccurred?: string | null }} diagnostics
 * @param {number} meanMz
 */
function appendCompactOvfLegend(root, layout, grid, diagnostics, meanMz) {
  const panel = layout.panel;
  if (!panel) return;
  const x = panel.x + 14;
  const width = panel.width - 28;
  const motion =
    diagnostics.maxFrameDelta == null
      ? "motion pending"
      : diagnostics.staticAtPrecision
        ? "motion small"
        : `Δm max ${diagnostics.maxFrameDelta.toExponential(2)}`;
  const group = el("g", { class: "sv-ovf-panel", "data-panel": "ovf-legend" });
  group.append(
    textEl("text", { x, y: panel.y + 18, fill: "#e8eef7", "font-size": 11, "font-weight": 900 }, "mz"),
    el("rect", {
      x,
      y: panel.y + 28,
      width,
      height: 15,
      fill: "url(#sv-mz-scale)",
      stroke: "#71839a",
      "stroke-width": 0.7
    }),
    textEl("text", { x, y: panel.y + 58, fill: "#2563eb", "font-size": 9.5 }, "−1 AP"),
    textEl("text", { x: x + width - 28, y: panel.y + 58, fill: "#dc2626", "font-size": 9.5 }, "+1 P"),
    textEl("text", { x, y: panel.y + 89, fill: "#c7d4e4", "font-size": 10.5, "font-weight": 700 }, `grid ${grid}`),
    textEl("text", { x, y: panel.y + 110, fill: "#9fb0c5", "font-size": 10 }, meanMz >= 0 ? "P / State 1" : "AP / State 0"),
    textEl("text", { x, y: panel.y + 131, fill: "#9fb0c5", "font-size": 10 }, "mz colour · mx/my arrows"),
    textEl(
      "text",
      {
        x,
        y: panel.y + 159,
        fill: diagnostics.staticAtPrecision ? "#ffd166" : "#8ce0be",
        "font-size": 10,
        "font-weight": 700
      },
      motion
    ),
    textEl(
      "text",
      { x, y: panel.y + 180, fill: "#7f93ab", "font-size": 9.5 },
      diagnostics.deltaOverlay ? "yellow outline: |Δm|" : "Δm overlay off"
    ),
    textEl(
      "text",
      { x, y: panel.y + 201, fill: diagnostics.switchingOccurred === "no" ? "#ff9ab0" : "#7f93ab", "font-size": 9.5 },
      diagnostics.switchingOccurred === "no"
        ? "switching failed / not achieved"
        : diagnostics.switchingOccurred === "yes"
          ? "switching occurred"
          : "classification pending"
    )
  );
  root.append(group);
}

/**
 * @param {SVGElement} root
 * @param {{
 *   layout: ReturnType<typeof createScientificSpinLayout>,
 *   alignment: string,
 *   alignmentScore: number,
 *   meanMz: number,
 *   grid: string,
 *   switchingOccurred?: string | null,
 *   finalAlignmentState?: string | null
 * }} options
 */
function appendMzLegendPanel(root, options) {
  const { layout, alignment, alignmentScore, meanMz, grid, switchingOccurred, finalAlignmentState } = options;
  const panel = layout.panel;
  if (!panel) return;
  const barX = panel.x + 14;
  const barW = panel.width - 28;
  const group = el("g", { class: "sv-ovf-panel", "data-panel": "ovf-legend" });
  group.append(
    el("rect", {
      x: panel.x,
      y: panel.y,
      width: panel.width,
      height: 220,
      rx: 6,
      fill: "rgba(4, 10, 18, 0.94)",
      stroke: "#54677e",
      "stroke-width": 1
    }),
    textEl("text", { x: barX, y: panel.y + 20, fill: "#e8eef7", "font-size": 10.5, "font-weight": 900 }, "RAW mz COLOUR SCALE"),
    el("rect", { x: barX, y: panel.y + 28, width: barW, height: 13, fill: "url(#sv-mz-scale)", stroke: "#54677e", "stroke-width": 0.6 }),
    textEl("text", { x: barX, y: panel.y + 54, fill: "#2563eb", "font-size": 9.5 }, "−1 (AP)"),
    textEl("text", { x: barX + barW - 34, y: panel.y + 54, fill: "#dc2626", "font-size": 9.5 }, "+1 (P)"),
    textEl("text", { x: barX, y: panel.y + 80, fill: "#e8eef7", "font-size": 10.5, "font-weight": 900 }, "FREE-LAYER ALIGNMENT"),
    el("rect", { x: barX, y: panel.y + 88, width: barW, height: 11, rx: 3, fill: "#0d1a28", stroke: "#3c5372", "stroke-width": 0.6 }),
    el("rect", {
      x: barX,
      y: panel.y + 88,
      width: Math.max(2, barW * alignmentScore),
      height: 11,
      rx: 3,
      fill: meanMz >= 0 ? "#4fd4ff" : "#ff7aa2"
    }),
    textEl("text", { x: barX, y: panel.y + 115, fill: "#c7d4e4", "font-size": 10, "font-weight": 700 }, alignment),
    textEl("text", { x: barX, y: panel.y + 131, fill: "#9fb0c5", "font-size": 9.5 }, `alignment ${(alignmentScore * 100).toFixed(1)}%`),
    textEl("text", { x: barX, y: panel.y + 153, fill: "#9fb0c5", "font-size": 9.5 }, `OVF grid ${grid}`),
    textEl(
      "text",
      { x: barX, y: panel.y + 169, fill: "#7f93ab", "font-size": 9.5 },
      finalAlignmentState ? `classified ${finalAlignmentState}` : "free layer only · context static"
    ),
    textEl(
      "text",
      {
        x: barX,
        y: panel.y + 185,
        fill: switchingOccurred === "no" ? "#ff7aa2" : "#7f93ab",
        "font-size": 9.5,
        "font-weight": switchingOccurred === "no" ? 700 : 400
      },
      switchingOccurred === "no"
        ? "switching failed / not achieved"
        : switchingOccurred === "yes"
          ? "switching occurred"
          : "no TMR / resistance claim"
    )
  );
  root.append(group);
}

/**
 * Render a center-viewport loading state while raw OVF vectors are being fetched.
 * This keeps real MuMax3 runs from falling back to the static schematic.
 * @param {SVGSVGElement} svg
 * @param {{label?: string, path?: string}|null} frame
 * @param {import("../lib/types").DeviceGeometry | null} [geometry]
 * @param {"desktop" | "compact"} [variant]
 */
export function renderOvfFrameLoadingViewport(svg, frame = null, geometry = null, variant = undefined) {
  const layout = createScientificSpinLayout(variant, geometry);
  svg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Loading raw MuMax3 OVF frame.");
  svg.replaceChildren();

  const defs = el("defs");
  appendEngineeringDefs(defs, el);
  appendLayerClips(defs, el, "sv-ovf-loading", layout);
  const root = el("g", { class: "sv-ovf-field sv-ovf-loading", "data-view-variant": layout.variant });
  root.setAttribute("data-pending-frame", frame?.label ?? "pending");
  appendCellBody(root, {
    el,
    text: textEl,
    layout,
    mode: "spin",
    roles: {
      free: "waiting for raw MuMax3 OVF frame",
      barrier: "context only · not MuMax3 OVF",
      reference: "context only · not MuMax3 OVF"
    }
  });
  svg.append(defs, root);
}

/**
 * Render a center-viewport error instead of silently leaving the schematic in place.
 *
 * @param {SVGSVGElement} svg
 * @param {string} message
 * @param {import("../lib/types").DeviceGeometry | null} [geometry]
 * @param {"desktop" | "compact"} [variant]
 */
export function renderOvfFrameErrorViewport(svg, message, geometry = null, variant = undefined) {
  const layout = createScientificSpinLayout(variant, geometry);
  svg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Raw MuMax3 OVF frame could not be rendered.");
  svg.replaceChildren();

  const defs = el("defs");
  appendEngineeringDefs(defs, el);
  appendLayerClips(defs, el, "sv-ovf-error", layout);
  const root = el("g", { class: "sv-ovf-field sv-ovf-error", "data-view-variant": layout.variant });
  appendHeader(root, {
    el,
    text: textEl,
    layout,
    title: "Raw MuMax3 OVF frame could not be drawn",
    subtitle: message.slice(0, 120),
    note: "No fallback motion is drawn. Check backend reachability or OVF parse details."
  });
  appendCellBody(root, {
    el,
    text: textEl,
    layout,
    mode: "spin",
    roles: {
      free: "raw MuMax3 OVF unavailable",
      barrier: "context only · not MuMax3 OVF",
      reference: "context only · not MuMax3 OVF"
    }
  });
  appendEngineeringScale(root, {
    el,
    text: textEl,
    layout,
    dimensions: geometryDimensionsNm(geometry)
  });
  appendDiagnostics(root, {
    el,
    text: textEl,
    layout,
    lines: [
      { text: "Source · MuMax3 OVF (failed)", tone: "strong" },
      { text: message.slice(0, 96) },
      { text: "Conceptual animation is never substituted for missing OVF data.", tone: "muted" }
    ]
  });
  svg.append(defs, root);
}
