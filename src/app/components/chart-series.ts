/**
 * Fixed, CVD-checked categorical palette for asset classes and cashflow series.
 * Pure data + helper, kept out of the "use client" charts module so server
 * components (e.g. the Overview positions table) can import it directly. Colors
 * stay inline hex - never wired to CSS variables, never reordered.
 */
export const ASSET_CLASS_SERIES: Array<{ key: string; label: string; color: string }> = [
  { key: "ETF_STOCK", label: "ETF", color: "#2a78d6" },
  { key: "STOCK", label: "Stocks", color: "#1baf7a" },
  { key: "BOND", label: "Bonds", color: "#eda100" },
  { key: "CASH", label: "Cash", color: "#008300" },
  { key: "CRYPTO", label: "Crypto", color: "#4a3aa7" },
  { key: "COMMODITY", label: "Commodities", color: "#e34948" },
  { key: "OTHER", label: "Other", color: "#e87ba4" }
];

export const INFLOW_COLOR = "#1baf7a";
export const OUTFLOW_COLOR = "#2a78d6";
export const SINGLE_SERIES_COLOR = "#2a78d6";

export function assetClassSeries(key: string) {
  return ASSET_CLASS_SERIES.find((series) => series.key === key) ?? { key, label: key, color: "#898781" };
}
