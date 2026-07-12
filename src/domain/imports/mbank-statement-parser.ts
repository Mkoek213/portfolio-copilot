import type { ExpenseCategory } from "@/domain/portfolio/types";
import { categorizeMbankTransaction, type ParsedMbankTransaction } from "./mbank-parser";

// One visual row of the statement table, with text assigned to the four
// columns of the operations table (or null when the column is empty).
export type StatementRow = {
  date: string | null;
  desc: string | null;
  amount: string | null;
  balance: string | null;
};

export type ParsedMbankStatement = {
  periodStart: Date;
  periodEnd: Date;
  accountNumber: string | null;
  openingBalance: number;
  closingBalance: number;
  creditCount: number;
  creditTotal: number;
  debitCount: number;
  debitTotal: number;
  transactions: ParsedMbankTransaction[];
};

export class MbankStatementParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MbankStatementParseError";
  }
}

const ROW_DATE_RE = /^\d{2}-\d{2}-\d{4}$/;
const CARD_TRANSACTION_DATE_RE = /DATA TRANSAKCJI:\s*(\d{4}-\d{2}-\d{2})/i;
const CARD_MASK_RE = /\b(\d{4} X{4} X{4} \d{4})\b/;
// Cuts the trailing "<amount> PLN <amount> PLN<card mask>" suffix off card merchant lines.
const MERCHANT_AMOUNT_SUFFIX_RE = /\s+-?[\d\s]+,\d{2}\s*PLN.*$/;
const COMPANY_HINT_RE = /SPÓŁKA|S\.A\.|SP\. Z O\.O\.|SP\.Z O\.O\.|BANK|URZĄD|FUNDACJA|STOWARZYSZENIE|TOWARZYSTWO|UL\.|AL\.|\d{2}-\d{3}/i;

function parsePolishAmount(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/[\s ]/g, "").replace(",", ".");
  if (!/^[+-]?\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseStatementDate(value: string | null | undefined): Date | null {
  const match = value?.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) {
    return null;
  }

  const parsed = new Date(`${match[3]}-${match[2]}-${match[1]}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseIsoDate(value: string): Date | null {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function rowText(row: StatementRow) {
  return [row.date, row.desc, row.amount, row.balance].filter(Boolean).join(" ");
}

function looksLikePersonName(value: string) {
  // Counterparty names often carry a trailing address ("JAN KOWALSKI UL. X 1 00-001 ...").
  const nameOnly = value.split(/\s+(?:UL\.|AL\.|OS\.|PL\.|\d{2}-\d{3})/i)[0].trim();

  if (!nameOnly || COMPANY_HINT_RE.test(nameOnly)) {
    return false;
  }

  const parts = nameOnly
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part && part !== ".");
  return parts.length >= 2 && parts.every((part) => /^[\p{L}'.-]+$/u.test(part));
}

type WorkingTransaction = {
  startDate: Date;
  bookingDate: Date | null;
  signedAmount: number;
  balanceAfter: number | null;
  type: string;
  descLines: string[];
};

function statementCategory(transaction: WorkingTransaction, merchant: string | null, direction: "INFLOW" | "OUTFLOW"): ExpenseCategory {
  const type = transaction.type.toUpperCase();

  if (/PRZELEW|BLIK P2P/.test(type) && merchant && looksLikePersonName(merchant)) {
    return "people_transfers";
  }

  const withoutType = [merchant ?? "", ...transaction.descLines].join(" ");
  const merchantBased = categorizeMbankTransaction(withoutType, direction);

  if (merchantBased !== "other" && merchantBased !== "income") {
    return merchantBased;
  }

  return categorizeMbankTransaction(`${transaction.type} ${withoutType}`, direction);
}

function finalizeTransaction(transaction: WorkingTransaction): ParsedMbankTransaction {
  const direction = transaction.signedAmount < 0 ? ("OUTFLOW" as const) : ("INFLOW" as const);
  let operationDate = transaction.startDate;
  let merchant: string | null = null;
  let accountLabel: string | null = null;

  const cardDateIndex = transaction.descLines.findIndex((line) => CARD_TRANSACTION_DATE_RE.test(line));
  if (cardDateIndex >= 0) {
    const cardDate = parseIsoDate(transaction.descLines[cardDateIndex].match(CARD_TRANSACTION_DATE_RE)![1]);
    if (cardDate) {
      operationDate = cardDate;
    }

    const merchantLine = transaction.descLines[cardDateIndex + 1];
    if (merchantLine) {
      merchant = merchantLine.replace(MERCHANT_AMOUNT_SUFFIX_RE, "").trim() || null;
    }
  } else {
    merchant =
      transaction.descLines.find((line) => !/^\d{20,}$/.test(line.trim()) && !CARD_MASK_RE.test(line))?.trim() || null;
  }

  for (const line of transaction.descLines) {
    const mask = line.match(CARD_MASK_RE);
    if (mask) {
      accountLabel = mask[1];
      break;
    }
  }

  const description = [transaction.type, ...transaction.descLines].join("; ").slice(0, 400);

  return {
    operationDate,
    bookingDate: transaction.bookingDate ?? transaction.startDate,
    amount: Math.abs(transaction.signedAmount),
    currency: "PLN",
    direction,
    description,
    merchant,
    category: statementCategory(transaction, merchant, direction),
    accountLabel,
    balanceAfter: transaction.balanceAfter
  };
}

export function parseMbankStatement(rows: StatementRow[]): ParsedMbankStatement {
  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;
  let accountNumber: string | null = null;
  let openingBalance: number | null = null;
  let closingBalance: number | null = null;
  let creditCount: number | null = null;
  let creditTotal: number | null = null;
  let debitCount: number | null = null;
  let debitTotal: number | null = null;

  const transactions: ParsedMbankTransaction[] = [];
  const signedAmounts: number[] = [];
  const balances: Array<number | null> = [];
  let current: WorkingTransaction | null = null;

  const finalizeCurrent = () => {
    if (current) {
      transactions.push(finalizeTransaction(current));
      signedAmounts.push(current.signedAmount);
      balances.push(current.balanceAfter);
      current = null;
    }
  };

  for (const row of rows) {
    const raw = rowText(row);

    const period = raw.match(/za okres od (\d{2}-\d{2}-\d{4}) do (\d{2}-\d{2}-\d{4})/i);
    if (period) {
      periodStart = parseStatementDate(period[1]);
      periodEnd = parseStatementDate(period[2]);
      continue;
    }

    if (/^Nr rachunku/i.test(raw)) {
      accountNumber = row.desc?.replace(/\s/g, "") ?? null;
      continue;
    }

    const opening = raw.match(/Saldo początkowe:\s*(-?[\d\s ]+,\d{2})/i);
    if (opening) {
      openingBalance = parsePolishAmount(opening[1]);
      continue;
    }

    const closing = raw.match(/Saldo końcowe:\s*(-?[\d\s ]+,\d{2})/i);
    if (closing) {
      closingBalance = parsePolishAmount(closing[1]);
      finalizeCurrent();
      break;
    }

    if (row.date === "Uznania" || row.date === "Obciążenia") {
      const count = Number(row.desc?.replace(/\s/g, ""));
      const total = parsePolishAmount(row.amount);
      if (Number.isInteger(count) && total !== null) {
        if (row.date === "Uznania") {
          creditCount = count;
          creditTotal = total;
        } else {
          debitCount = count;
          debitTotal = total;
        }
      }
      continue;
    }

    const rowDate = row.date && ROW_DATE_RE.test(row.date.trim()) ? parseStatementDate(row.date) : null;
    const rowAmount = parsePolishAmount(row.amount);
    const rowBalance = parsePolishAmount(row.balance);

    if (rowDate && rowAmount !== null && rowBalance !== null && row.desc) {
      finalizeCurrent();
      current = {
        startDate: rowDate,
        bookingDate: null,
        signedAmount: rowAmount,
        balanceAfter: rowBalance,
        type: row.desc.trim(),
        descLines: []
      };
      continue;
    }

    if (current && rowDate && row.desc && rowAmount === null) {
      current.bookingDate = current.bookingDate ?? rowDate;
      current.descLines.push(row.desc.trim());
      continue;
    }

    if (current && !row.date && row.desc && rowAmount === null && rowBalance === null) {
      current.descLines.push(row.desc.trim());
    }
  }

  finalizeCurrent();

  if (!periodStart || !periodEnd) {
    throw new MbankStatementParseError("Could not find the statement period in the mBank statement PDF.");
  }

  if (openingBalance === null || closingBalance === null) {
    throw new MbankStatementParseError("Could not find opening/closing balance in the mBank statement PDF.");
  }

  if (creditCount === null || creditTotal === null || debitCount === null || debitTotal === null) {
    throw new MbankStatementParseError("Could not find the operations summary in the mBank statement PDF.");
  }

  const inflows = transactions.filter((transaction) => transaction.direction === "INFLOW");
  const outflows = transactions.filter((transaction) => transaction.direction === "OUTFLOW");
  const inflowTotal = inflows.reduce((sum, transaction) => sum + transaction.amount, 0);
  const outflowTotal = outflows.reduce((sum, transaction) => sum + transaction.amount, 0);

  if (inflows.length !== creditCount || outflows.length !== debitCount) {
    throw new MbankStatementParseError(
      `Parsed operation counts do not match the statement summary: parsed ${inflows.length} credit(s) and ${outflows.length} debit(s), statement declares ${creditCount} and ${debitCount}.`
    );
  }

  if (Math.abs(inflowTotal - creditTotal) > 0.01 || Math.abs(outflowTotal - Math.abs(debitTotal)) > 0.01) {
    throw new MbankStatementParseError(
      `Parsed operation totals do not match the statement summary: parsed ${inflowTotal.toFixed(2)} / -${outflowTotal.toFixed(2)}, statement declares ${creditTotal.toFixed(2)} / ${debitTotal.toFixed(2)}.`
    );
  }

  let runningBalance = openingBalance;
  for (let index = 0; index < signedAmounts.length; index++) {
    runningBalance += signedAmounts[index];
    const expected = balances[index];
    if (expected !== null && Math.abs(runningBalance - expected) > 0.01) {
      throw new MbankStatementParseError(
        `Statement balance chain mismatch at operation ${index + 1}: computed ${runningBalance.toFixed(2)}, statement shows ${expected.toFixed(2)}.`
      );
    }
  }

  if (Math.abs(runningBalance - closingBalance) > 0.01) {
    throw new MbankStatementParseError(
      `Statement closing balance mismatch: computed ${runningBalance.toFixed(2)}, statement shows ${closingBalance.toFixed(2)}.`
    );
  }

  return {
    periodStart,
    periodEnd,
    accountNumber,
    openingBalance,
    closingBalance,
    creditCount,
    creditTotal,
    debitCount,
    debitTotal,
    transactions
  };
}

type PdfTextItem = { str: string; transform: number[] };

// Text below this y coordinate is the per-page legal footer and page number.
const PAGE_FOOTER_MAX_Y = 55;
// Text items whose y coordinates differ by no more than this belong to one visual row.
const ROW_Y_TOLERANCE = 4.5;

function classifyRow(cells: Array<{ x: number; text: string }>, anchors: { descX: number; amountX: number; balanceX: number }): StatementRow {
  const row: StatementRow = { date: null, desc: null, amount: null, balance: null };

  for (const cell of cells) {
    const column =
      cell.x < anchors.descX - 15 ? "date" : cell.x < anchors.amountX - 20 ? "desc" : cell.x < anchors.balanceX - 5 ? "amount" : "balance";
    row[column] = row[column] ? `${row[column]} ${cell.text}` : cell.text;
  }

  return row;
}

export async function extractMbankStatementRows(data: Uint8Array, password?: string): Promise<StatementRow[]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const loadingTask = getDocument({ data, password, verbosity: 0 });
  const document = await loadingTask.promise.catch((error: unknown) => {
    const name = error instanceof Error ? error.name : "";
    if (name === "PasswordException") {
      throw new MbankStatementParseError(
        "The mBank statement PDF is password-protected. Set MBANK_STATEMENT_PDF_PASSWORD (PESEL or the custom password from mBank settings) in the environment."
      );
    }

    throw new MbankStatementParseError(`Could not open the mBank statement PDF: ${error instanceof Error ? error.message : "unknown error"}.`);
  });

  try {
    const rows: StatementRow[] = [];

    for (let pageNo = 1; pageNo <= document.numPages; pageNo++) {
      const page = await document.getPage(pageNo);
      const content = await page.getTextContent();
      const items = (content.items as PdfTextItem[])
        .map((item) => ({ x: item.transform[4], y: item.transform[5], text: item.str.trim() }))
        .filter((item) => item.text && item.y > PAGE_FOOTER_MAX_Y)
        .sort((a, b) => b.y - a.y || a.x - b.x);

      const anchors = {
        descX: items.find((item) => item.text === "Opis operacji")?.x ?? 118,
        amountX: items.find((item) => item.text === "Kwota")?.x ?? 407,
        balanceX: items.find((item) => item.text === "Saldo po operacji")?.x ?? 470
      };

      let cluster: typeof items = [];
      let clusterY: number | null = null;

      const flush = () => {
        if (cluster.length > 0) {
          rows.push(classifyRow(cluster.sort((a, b) => a.x - b.x), anchors));
          cluster = [];
        }
      };

      for (const item of items) {
        if (clusterY !== null && clusterY - item.y > ROW_Y_TOLERANCE) {
          flush();
        }

        cluster.push(item);
        clusterY = item.y;
      }

      flush();
    }

    return rows;
  } finally {
    await loadingTask.destroy();
  }
}

export async function parseMbankStatementPdf(data: Uint8Array, password?: string): Promise<ParsedMbankStatement> {
  return parseMbankStatement(await extractMbankStatementRows(data, password));
}
