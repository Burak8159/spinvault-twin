/**
 * Unit helpers for UI-level integrity checks.
 * These lists are display/serialization helpers, not a physics unit system.
 */

/** @type {Record<import("./types").UnitCategory, import("./types").Unit[]>} */
export const UNITS_BY_CATEGORY = {
  length: ["nm", "um", "m"],
  time: ["ns", "ps", "s"],
  temperature: ["K"],
  dimensionless: ["dimensionless"],
  magnetization: ["A/m"],
  field: ["T"],
  exchange: ["J/m"],
  anisotropy: ["J/m^3"],
  currentDensity: ["A/m^2"],
  energy: ["eV"]
};

/** @type {ReadonlySet<import("./types").Unit>} */
export const KNOWN_UNITS = new Set(
  Object.values(UNITS_BY_CATEGORY).flat()
);

/**
 * @param {string} unit
 * @returns {unit is import("./types").Unit}
 */
export function isKnownUnit(unit) {
  return KNOWN_UNITS.has(/** @type {import("./types").Unit} */ (unit));
}

/**
 * @param {string} unit
 * @param {import("./types").UnitCategory} category
 */
export function isUnitForCategory(unit, category) {
  return UNITS_BY_CATEGORY[category].includes(/** @type {import("./types").Unit} */ (unit));
}

/**
 * @param {import("./types").Quantity} quantity
 * @param {number} [digits]
 */
export function formatQuantity(quantity, digits = 2) {
  if (!Number.isFinite(quantity.value)) return `invalid ${quantity.unit}`;
  const value = Number.isInteger(quantity.value) ? String(quantity.value) : quantity.value.toFixed(digits);
  return `${value} ${quantity.unit}`;
}

/**
 * @param {string | number} raw
 */
export function parseNumericInput(raw) {
  if (typeof raw === "number") return raw;
  const trimmed = raw.trim();
  if (trimmed === "") return NaN;
  return Number(trimmed.replace(",", "."));
}
