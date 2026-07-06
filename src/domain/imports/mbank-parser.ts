import type { ExpenseCategory, TransactionDirection } from "@/domain/portfolio/types";

export { EXPENSE_CATEGORIES, isExpenseCategory } from "@/domain/portfolio/categories";

export type ParsedMbankTransaction = {
  operationDate: Date;
  bookingDate?: Date | null;
  amount: number;
  currency: string;
  direction: TransactionDirection;
  description: string;
  merchant: string | null;
  category: ExpenseCategory;
  accountLabel?: string | null;
  balanceAfter?: number | null;
};

export type ParsedMbankEmail = {
  operationDate: Date;
  transactions: ParsedMbankTransaction[];
};

export class MbankParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MbankParseError";
  }
}

const CATEGORY_KEYWORDS: Array<{ category: ExpenseCategory; keywords: string[] }> = [
  { category: "food", keywords: ["biedronka", "lidl", "zabka", "żabka", "carrefour", "kaufland", "spożyw", "restaurant", "restaur", "glovo", "wolt"] },
  { category: "housing", keywords: ["czynsz", "rent", "mieszkanie", "energia", "prąd", "gaz", "woda", "internet dom"] },
  { category: "transport", keywords: ["uber", "bolt", "orlen", "bp ", "shell", "paliw", "bilet", "ztm", "pkp", "koleje"] },
  { category: "education", keywords: ["kurs", "szko", "uczeln", "udemy", "coursera", "book", "książ"] },
  { category: "subscriptions", keywords: ["netflix", "spotify", "youtube", "openai", "apple.com/bill", "subskry", "abonament"] },
  { category: "health", keywords: ["apteka", "lekarz", "medic", "luxmed", "enel", "zdrow"] },
  { category: "entertainment", keywords: ["kino", "cinema", "steam", "playstation", "xbox", "teatr", "event"] },
  { category: "investments", keywords: ["xtb", "binance", "makler", "broker", "inwest", "etf", "giełd"] },
  { category: "shopping", keywords: ["allegro", "amazon", "zalando", "media expert", "rtv", "euro.com", "sklep", "zakup", "zakupy"] },
  { category: "income", keywords: ["wynagrodzenie", "salary", "przelew przychodzący", "umowa", "faktura"] },
  { category: "fees", keywords: ["prowizja", "opłata", "oplata", "fee", "pakiet"] }
];

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function isPeopleTransferDescription(description: string, normalized: string) {
  if (!/\bprzelew\s+(wych|wychodzacy|wychodzący|przych|przychodzacy|przychodzący)\b/.test(normalized)) {
    return false;
  }

  const counterparty = description.match(/\b(?:dla|od)\s+([^;]+)/i)?.[1]?.trim();
  if (!counterparty) {
    return false;
  }

  if (/\bzwrot\s+za\b/.test(normalized)) {
    return true;
  }

  const nameParts = counterparty.split(/\s+/).filter(Boolean);
  return nameParts.length >= 2 && nameParts.every((part) => /^[\p{L}'.-]+$/u.test(part));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)));
}

export function normalizeMbankEmailBody(body: string) {
  return decodeHtmlEntities(body)
    .replace(/\r/g, "")
    .replace(/<\s*(br|\/p|\/div|\/tr|\/li)\s*\/?>/gi, "\n")
    .replace(/<\s*\/t[dh]\s*>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function categorizeMbankTransaction(description: string, direction: TransactionDirection): ExpenseCategory {
  const normalized = normalizeText(description);

  if (direction === "INFLOW") {
    const income = CATEGORY_KEYWORDS.find((entry) => entry.category === "income");
    if (income?.keywords.some((keyword) => normalized.includes(keyword))) {
      return "income";
    }
  }

  if (isPeopleTransferDescription(description, normalized)) {
    return "people_transfers";
  }

  for (const entry of CATEGORY_KEYWORDS) {
    if (entry.category === "income") {
      continue;
    }

    if (entry.keywords.some((keyword) => normalized.includes(keyword))) {
      return entry.category;
    }
  }

  return direction === "INFLOW" ? "income" : "other";
}

function parseDate(value: string): Date | null {
  const match = value.match(/(\d{4})[-.](\d{2})[-.](\d{2})|(\d{2})[.\/-](\d{2})[.\/-](\d{4})/);
  if (!match) {
    return null;
  }

  const iso = match[1]
    ? `${match[1]}-${match[2]}-${match[3]}`
    : `${match[6]}-${match[5]}-${match[4]}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function extractField(body: string, labels: string[]): string | null {
  for (const label of labels) {
    const escaped = escapeRegExp(label);
    const match = body.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*[:\\-]?\\s*([^\\n]+)`, "i"));

    if (match?.[1]?.trim()) {
      return match[1].trim();
    }
  }

  return null;
}

export function parsePolishMoney(value: string): { amount: number; currency: string } | null {
  const match = value.match(/([+-]?\s*\d[\d\s]*(?:[,.]\d{2})?)\s*(PLN|EUR|USD|GBP)?/i);
  if (!match) {
    return null;
  }

  const amount = Number(match[1].replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(amount)) {
    return null;
  }

  return {
    amount,
    currency: (match[2] ?? "PLN").toUpperCase()
  };
}

function parseBalance(value: string): number | null {
  const balanceMatch = value.match(/saldo(?:\s+po(?:\s+operacji)?)?\s*[:=]?\s*([+-]?\s*\d[\d\s]*(?:[,.]\d{2})?)/i);
  if (!balanceMatch) {
    return null;
  }

  return parsePolishMoney(balanceMatch[1])?.amount ?? null;
}

function directionFromAmountAndText(amount: number, text: string): TransactionDirection {
  if (amount < 0) {
    return "OUTFLOW";
  }

  if (amount > 0) {
    const normalized = normalizeText(text);
    if (/(obciąż|obciaz|płatno|platno|wypłat|wyplat|przelew wych|wych\.|przelew wychodzący|przelew wychodzacy|zakup|kartą|karta)/i.test(normalized)) {
      return "OUTFLOW";
    }
  }

  return "INFLOW";
}

function splitTransactionLine(line: string) {
  if (line.includes("|")) {
    return line.split("|").map((part) => part.trim()).filter(Boolean);
  }

  if (line.includes(";")) {
    return line.split(";").map((part) => part.trim()).filter(Boolean);
  }

  return line.split(/\s{2,}/).map((part) => part.trim()).filter(Boolean);
}

function parseTransactionLine(line: string, fallbackDate: Date): ParsedMbankTransaction | null {
  const parts = splitTransactionLine(line);
  const date = parseDate(parts[0] ?? line) ?? parseDate(line) ?? fallbackDate;
  const amountIndexes = parts
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => /[+-]?\s*\d[\d\s]*(?:[,.]\d{2})\s*(PLN|EUR|USD|GBP)/i.test(part));
  const amountPart = amountIndexes.find(({ part }) => /[+-]\s*\d/.test(part)) ?? amountIndexes[0];

  if (!amountPart) {
    return null;
  }

  const money = parsePolishMoney(amountPart.part);
  if (!money || money.amount === 0) {
    return null;
  }

  const excludedIndexes = new Set(amountIndexes.map(({ index }) => index));
  const descriptionParts = parts.filter((part, index) => !excludedIndexes.has(index) && !parseDate(part) && !/^saldo|^kwota|^data/i.test(part));
  const description = descriptionParts.join(" ").replace(/saldo.*$/i, "").trim() || line.replace(amountPart.part, "").trim();
  const merchant = descriptionParts[0]?.trim() || null;
  const direction = directionFromAmountAndText(money.amount, line);

  if (!description || /saldo początkowe|saldo poczatkowe|saldo końcowe|saldo koncowe|suma uznań|suma uznan|suma obciążeń|suma obciazen|razem/i.test(description)) {
    return null;
  }

  return {
    operationDate: date,
    bookingDate: date,
    amount: Math.abs(money.amount),
    currency: money.currency,
    direction,
    description,
    merchant,
    category: categorizeMbankTransaction(description, direction),
    balanceAfter: parseBalance(line)
  };
}

function parseMbankNotificationLine(line: string, fallbackDate: Date): ParsedMbankTransaction | null {
  const amountMatch = line.match(/kwota\s+([+-]?\s*\d[\d\s]*(?:[,.]\d{2})?)\s*(PLN|EUR|USD|GBP)/i);
  if (!amountMatch) {
    return null;
  }

  const money = parsePolishMoney(`${amountMatch[1]} ${amountMatch[2]}`);
  if (!money || money.amount === 0) {
    return null;
  }

  const operationText = line.replace(/^\d{1,2}:\d{2}\s+/, "").trim();
  const description = operationText.replace(/\s*Dost\.\s+[+-]?\s*\d[\d\s]*(?:[,.]\d{2})?\s*(PLN|EUR|USD|GBP).*$/i, "").trim();
  if (!description || !/mbank:|kwota/i.test(description)) {
    return null;
  }

  const direction = directionFromAmountAndText(money.amount, description);
  const merchant = description.match(/\b(?:dla|od)\s+([^;]+)/i)?.[1]?.trim() ?? null;
  const balanceMatch = line.match(/Dost\.\s+([+-]?\s*\d[\d\s]*(?:[,.]\d{2})?)\s*(PLN|EUR|USD|GBP)/i);

  return {
    operationDate: fallbackDate,
    bookingDate: fallbackDate,
    amount: Math.abs(money.amount),
    currency: money.currency,
    direction,
    description,
    merchant,
    category: categorizeMbankTransaction(description, direction),
    balanceAfter: balanceMatch ? parsePolishMoney(`${balanceMatch[1]} ${balanceMatch[2]}`)?.amount ?? null : null
  };
}

function parseMbankNotificationTransactions(lines: string[], fallbackDate: Date) {
  return lines
    .map((line) => parseMbankNotificationLine(line, fallbackDate))
    .filter((transaction): transaction is ParsedMbankTransaction => Boolean(transaction));
}

function parseKeyValueTransaction(body: string, fallbackDate: Date): ParsedMbankTransaction | null {
  const date =
    parseDate(
      extractField(body, ["Data operacji", "Data transakcji", "Data księgowania", "Data ksiegowania", "Operacja z dnia"]) ?? ""
    ) ?? fallbackDate;
  const amountText = extractField(body, ["Kwota operacji", "Kwota transakcji", "Kwota", "Wartość operacji", "Wartosc operacji"]);
  const money = amountText ? parsePolishMoney(amountText) : null;

  if (!money || money.amount === 0) {
    return null;
  }

  const merchant =
    extractField(body, ["Odbiorca", "Nadawca", "Kontrahent", "Nazwa odbiorcy", "Nazwa nadawcy", "Punkt handlowo-usługowy"]) ?? null;
  const title = extractField(body, ["Opis operacji", "Tytuł", "Tytul", "Rodzaj operacji", "Szczegóły", "Szczegoly"]);
  const descriptionParts = [title, merchant].filter((part): part is string => Boolean(part));
  const description = descriptionParts.join(" - ").trim();

  if (!description) {
    return null;
  }

  const direction = directionFromAmountAndText(money.amount, `${amountText ?? ""}\n${description}`);

  return {
    operationDate: date,
    bookingDate: date,
    amount: Math.abs(money.amount),
    currency: money.currency,
    direction,
    description,
    merchant,
    category: categorizeMbankTransaction(description, direction),
    accountLabel: extractField(body, ["Rachunek", "Konto", "Numer rachunku"]),
    balanceAfter: parsePolishMoney(extractField(body, ["Saldo po operacji", "Saldo"]) ?? "")?.amount ?? parseBalance(body)
  };
}

export function parseMbankEmail(body: string): ParsedMbankEmail {
  const normalized = normalizeMbankEmailBody(body);
  const explicitOperationDate = parseDate(normalized.match(/(?:data operacji|operacja z dnia|dzień operacji)\s*[:\-]?\s*([^\n]+)/i)?.[1] ?? "");
  const notificationDate = parseDate(normalized.match(/(?:^|\n)\s*((?:\d{4}[-.]\d{2}[-.]\d{2})|(?:\d{2}[.\/-]\d{2}[.\/-]\d{4}))\s*-\s*Powiadomienie e-mail/i)?.[1] ?? "");
  const operationDate = explicitOperationDate ?? notificationDate ?? parseDate(normalized);

  if (!operationDate) {
    throw new MbankParseError("Could not find operation date in mBank email.");
  }

  const keyValueTransaction = parseKeyValueTransaction(normalized, operationDate);

  if (keyValueTransaction) {
    return {
      operationDate: keyValueTransaction.operationDate,
      transactions: [keyValueTransaction]
    };
  }

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const notificationTransactions = parseMbankNotificationTransactions(lines, operationDate);
  const transactions = notificationTransactions.length > 0
    ? notificationTransactions
    : lines
        .map((line) => parseTransactionLine(line, operationDate))
        .filter((transaction): transaction is ParsedMbankTransaction => Boolean(transaction));

  if (transactions.length === 0) {
    throw new MbankParseError("Could not find transaction rows in mBank email.");
  }

  return {
    operationDate,
    transactions
  };
}
