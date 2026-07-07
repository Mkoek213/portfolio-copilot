const PL_LOCALE = "pl-PL";

export function formatMoney(value: number | { toString(): string } | null | undefined, currency = "PLN") {
  const number = Number(value ?? 0);
  return `${number.toLocaleString(PL_LOCALE, { maximumFractionDigits: 0 })} ${currency}`;
}

export function formatMoneyExact(value: number | { toString(): string } | null | undefined, currency = "PLN") {
  const number = Number(value ?? 0);
  return `${number.toLocaleString(PL_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export function formatSignedMoney(value: number | { toString(): string } | null | undefined, direction: "INFLOW" | "OUTFLOW", currency = "PLN") {
  const number = Math.abs(Number(value ?? 0));
  const sign = direction === "INFLOW" ? "+" : "−";
  return `${sign}${number.toLocaleString(PL_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export function formatNumber(value: number) {
  return value.toLocaleString(PL_LOCALE, { maximumFractionDigits: 0 });
}

export function formatPercent(value: number) {
  return `${value.toLocaleString(PL_LOCALE, { maximumFractionDigits: 1 })}%`;
}

export function formatDate(value: Date | null | undefined) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat(PL_LOCALE, { dateStyle: "medium" }).format(value);
}

export function formatDateTime(value: Date | null | undefined) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat(PL_LOCALE, {
    dateStyle: "short",
    timeStyle: "short"
  }).format(value);
}

export function formatTime(value: Date | null | undefined) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat(PL_LOCALE, { timeStyle: "short" }).format(value);
}

export function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);

  if (!year || !month) {
    return monthKey;
  }

  return new Intl.DateTimeFormat(PL_LOCALE, { month: "short" }).format(new Date(year, month - 1, 1));
}
