import type { TransactionDirection } from "@/domain/portfolio/types";

// Provenance of a transaction's category, validated at the domain boundary
// (the DB column is a plain String, matching the repo's convention). Only
// "learned" drives UI; the rest encode provenance for future work.
// Precedence at write time: user > learned > llm > deterministic.
export const CATEGORY_SOURCES = ["user", "learned", "llm", "deterministic"] as const;

export type CategorySource = (typeof CATEGORY_SOURCES)[number];

export const DEFAULT_CATEGORY_SOURCE: CategorySource = "deterministic";

export function isCategorySource(value: string): value is CategorySource {
  return (CATEGORY_SOURCES as readonly string[]).includes(value);
}

export function categorySourceOrDefault(value: string | null | undefined): CategorySource {
  return typeof value === "string" && isCategorySource(value) ? value : DEFAULT_CATEGORY_SOURCE;
}

// IBAN-like or long digit runs are raw ledger noise, never a stable merchant.
const DIGIT_RUN = /\d{6,}/;
const IBAN_LIKE = /[a-z]{2}\d{2}[a-z0-9]{10,}/i;

/**
 * Normalizes the parser's extracted merchant into a stable rule key, or returns
 * `null` when the merchant cannot be cleanly keyed (a `null` key means "do not
 * learn"). Lowercases, collapses internal whitespace, and strips leading and
 * trailing non-alphanumerics, so `"DOMINIKA ."` becomes `"dominika"`. Rejects
 * weak keys: shorter than two characters, or still shaped like raw ledger text
 * (long digit runs / IBAN-like tokens).
 */
export function normalizeMerchantKey(merchant: string | null | undefined): string | null {
  if (!merchant) {
    return null;
  }

  const collapsed = merchant.toLowerCase().replace(/\s+/g, " ").trim();
  // Strip leading/trailing non-alphanumerics (Unicode letters/digits kept).
  const stripped = collapsed.replace(/^[^\p{L}\p{N}]+/u, "").replace(/[^\p{L}\p{N}]+$/u, "");

  if (stripped.length < 2) {
    return null;
  }

  if (IBAN_LIKE.test(stripped) || DIGIT_RUN.test(stripped)) {
    return null;
  }

  return stripped;
}

// The lookup key for a rule map: normalized merchant plus direction. Both a
// learned rule and an incoming transaction resolve to the same string here.
export function ruleMapKey(matchKey: string, direction: TransactionDirection): string {
  return `${matchKey}|${direction}`;
}
