import type { ReportDraft } from "./reporter";

export type CriticResult = {
  verdict: "PASS" | "NEEDS_REVIEW" | "FAIL";
  notes: string[];
};

const PROHIBITED_ACTION_PATTERNS = [
  /wykonaj\s+przelew/i,
  /zleć\s+przelew/i,
  /kup\s+natychmiast/i,
  /sprzedaj\s+natychmiast/i,
  /place\s+an\s+order/i,
  /execute\s+a\s+transfer/i
];

export function critiqueReport(report: ReportDraft): CriticResult {
  const notes: string[] = [];

  if (report.unknowns.length === 0) {
    notes.push("Raport nie zawiera sekcji braków danych.");
  }

  if (!report.markdown.includes("Read-only constraint")) {
    notes.push("Raport nie przypomina o ograniczeniu read-only.");
  }

  if (report.sources.length === 0) {
    notes.push("Raport nie wskazuje źródeł danych.");
  }

  if (!report.markdown.includes("## Spending")) {
    notes.push("Raport nie zawiera sekcji wydatków.");
  }

  if (PROHIBITED_ACTION_PATTERNS.some((pattern) => pattern.test(report.markdown))) {
    notes.push("Raport zawiera niedozwoloną instrukcję wykonania operacji finansowej.");
  }

  if (/web search|internet|źródła internetowe/i.test(report.markdown) && !report.sources.some((source) => source.includes("web"))) {
    notes.push("Raport sugeruje użycie web search mimo braku takiego źródła w tej iteracji.");
  }

  return {
    verdict: notes.length === 0 ? "PASS" : "NEEDS_REVIEW",
    notes
  };
}
