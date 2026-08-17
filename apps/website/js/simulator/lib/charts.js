/**
 * Lightweight SVG path helpers for Twin result series.
 * Plots only provided points — never invents physics.
 */

/**
 * @param {import("./types").ResultSeries} series
 * @param {{ width?: number, height?: number, padX?: number, padY?: number }} [opts]
 */
export function seriesToPath(series, opts = {}) {
  if (!series.points.length) return "";
  const width = opts.width ?? 276;
  const height = opts.height ?? 96;
  const padX = opts.padX ?? 8;
  const padY = opts.padY ?? 8;
  const xs = series.points.map((point) => point.x);
  const ys = series.points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;
  return series.points
    .map((point, index) => {
      const x = padX + ((point.x - minX) / spanX) * plotW;
      const y = height - padY - ((point.y - minY) / spanY) * plotH;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

/**
 * Overlay several series on a shared x/y scale (for mx/my/mz trajectories).
 * @param {Array<import("./types").ResultSeries | undefined | null>} seriesList
 * @param {{ width?: number, height?: number, padX?: number, padY?: number }} [opts]
 * @returns {{ paths: Array<{ id: string, label: string, d: string }>, empty: boolean }}
 */
export function overlaySeriesPaths(seriesList, opts = {}) {
  /** @type {import("./types").ResultSeries[]} */
  const series = seriesList.filter(
    /** @type {(item: import("./types").ResultSeries | undefined | null) => item is import("./types").ResultSeries} */ (
      (item) => Boolean(item && item.points?.length)
    )
  );
  if (!series.length) return { paths: [], empty: true };

  const width = opts.width ?? 320;
  const height = opts.height ?? 140;
  const padX = opts.padX ?? 12;
  const padY = opts.padY ?? 12;
  const xs = series.flatMap((item) => item.points.map((point) => point.x));
  const ys = series.flatMap((item) => item.points.map((point) => point.y));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;

  const paths = series.map((item) => ({
    id: item.id,
    label: item.label,
    d: item.points
      .map((point, index) => {
        const x = padX + ((point.x - minX) / spanX) * plotW;
        const y = height - padY - ((point.y - minY) / spanY) * plotH;
        return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ")
  }));

  return { paths, empty: false };
}

/**
 * Paper-style 2D plot geometry from one or more series.
 * @param {Array<import("./types").ResultSeries | undefined | null>} seriesList
 * @param {{
 *   width?: number,
 *   height?: number,
 *   padLeft?: number,
 *   padRight?: number,
 *   padTop?: number,
 *   padBottom?: number,
 *   yMin?: number,
 *   yMax?: number
 * }} [opts]
 */
export function buildScientificPlot(seriesList, opts = {}) {
  /** @type {import("./types").ResultSeries[]} */
  const series = seriesList.filter(
    /** @type {(item: import("./types").ResultSeries | undefined | null) => item is import("./types").ResultSeries} */ (
      (item) => Boolean(item && item.points?.length)
    )
  );
  const width = opts.width ?? 520;
  const height = opts.height ?? 220;
  const padLeft = opts.padLeft ?? 48;
  const padRight = opts.padRight ?? 16;
  const padTop = opts.padTop ?? 16;
  const padBottom = opts.padBottom ?? 36;
  if (!series.length) {
    return {
      empty: true,
      width,
      height,
      padLeft,
      padRight,
      padTop,
      padBottom,
      minX: 0,
      maxX: 1,
      minY: opts.yMin ?? -1,
      maxY: opts.yMax ?? 1,
      paths: [],
      mapX: () => padLeft,
      mapY: () => height / 2
    };
  }
  const xs = series.flatMap((item) => item.points.map((point) => point.x));
  const ys = series.flatMap((item) => item.points.map((point) => point.y));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const dataMinY = Math.min(...ys);
  const dataMaxY = Math.max(...ys);
  const minY = opts.yMin ?? Math.min(dataMinY, -1);
  const maxY = opts.yMax ?? Math.max(dataMaxY, 1);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  /**
   * @param {number} x
   */
  const mapX = (x) => padLeft + ((x - minX) / spanX) * plotW;
  /**
   * @param {number} y
   */
  const mapY = (y) => height - padBottom - ((y - minY) / spanY) * plotH;
  const paths = series.map((item) => ({
    id: item.id,
    label: item.label,
    d: item.points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${mapX(point.x).toFixed(1)} ${mapY(point.y).toFixed(1)}`)
      .join(" ")
  }));
  return {
    empty: false,
    width,
    height,
    padLeft,
    padRight,
    padTop,
    padBottom,
    minX,
    maxX,
    minY,
    maxY,
    paths,
    mapX,
    mapY
  };
}

/**
 * @param {number} value
 * @param {number} digits
 */
function niceLabel(value, digits = 2) {
  if (!Number.isFinite(value)) return "n/a";
  if (Math.abs(value) !== 0 && (Math.abs(value) < 1e-3 || Math.abs(value) >= 1e4)) {
    return value.toExponential(digits);
  }
  return value.toFixed(digits);
}

/**
 * Render axis ticks/labels as SVG markup strings (no invented data).
 * @param {ReturnType<typeof buildScientificPlot>} plot
 * @param {{ xLabel?: string, yLabel?: string, xTicks?: number, yTicks?: number }} [opts]
 */
export function scientificAxisMarkup(plot, opts = {}) {
  const xTicks = opts.xTicks ?? 5;
  const yTicks = opts.yTicks ?? 5;
  /** @type {string[]} */
  const parts = [];
  parts.push(
    `<rect x="${plot.padLeft}" y="${plot.padTop}" width="${
      plot.width - plot.padLeft - plot.padRight
    }" height="${plot.height - plot.padTop - plot.padBottom}" fill="#ffffff" stroke="#1f2937" stroke-width="1"/>`
  );
  for (let i = 0; i <= xTicks; i += 1) {
    const t = i / xTicks;
    const xVal = plot.minX + t * (plot.maxX - plot.minX || 1);
    const x = plot.mapX(xVal);
    parts.push(
      `<line x1="${x.toFixed(1)}" y1="${(plot.height - plot.padBottom).toFixed(1)}" x2="${x.toFixed(
        1
      )}" y2="${(plot.height - plot.padBottom + 4).toFixed(1)}" stroke="#1f2937"/>`,
      `<text x="${x.toFixed(1)}" y="${(plot.height - 12).toFixed(1)}" text-anchor="middle" fill="#111827" font-size="9">${niceLabel(
        xVal
      )}</text>`
    );
  }
  for (let i = 0; i <= yTicks; i += 1) {
    const t = i / yTicks;
    const yVal = plot.minY + t * (plot.maxY - plot.minY || 1);
    const y = plot.mapY(yVal);
    parts.push(
      `<line x1="${(plot.padLeft - 4).toFixed(1)}" y1="${y.toFixed(1)}" x2="${plot.padLeft.toFixed(
        1
      )}" y2="${y.toFixed(1)}" stroke="#1f2937"/>`,
      `<text x="${(plot.padLeft - 6).toFixed(1)}" y="${(y + 3).toFixed(
        1
      )}" text-anchor="end" fill="#111827" font-size="9">${niceLabel(yVal)}</text>`
    );
  }
  if (opts.xLabel) {
    parts.push(
      `<text x="${(plot.width / 2).toFixed(1)}" y="${(plot.height - 2).toFixed(
        1
      )}" text-anchor="middle" fill="#111827" font-size="10" font-weight="600">${opts.xLabel}</text>`
    );
  }
  if (opts.yLabel) {
    parts.push(
      `<text x="12" y="${(plot.height / 2).toFixed(
        1
      )}" text-anchor="middle" fill="#111827" font-size="10" font-weight="600" transform="rotate(-90 12 ${
        plot.height / 2
      })">${opts.yLabel}</text>`
    );
  }
  return parts.join("");
}
