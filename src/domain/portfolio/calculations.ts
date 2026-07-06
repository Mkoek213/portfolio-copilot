import type { AllocationItem, PositionSnapshot } from "./types";

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

export function buildAllocation(
  positions: PositionSnapshot[],
  totalValue: number,
  getKey: (position: PositionSnapshot) => string,
  getLabel: (position: PositionSnapshot) => string = getKey
): AllocationItem[] {
  const totals = new Map<string, { label: string; value: number }>();

  for (const position of positions) {
    const key = getKey(position);
    const current = totals.get(key) ?? { label: getLabel(position), value: 0 };
    current.value += position.marketValueBase;
    totals.set(key, current);
  }

  return Array.from(totals.entries())
    .map(([key, item]) => ({
      key,
      label: item.label,
      value: roundMoney(item.value),
      percent: totalValue > 0 ? roundPercent((item.value / totalValue) * 100) : 0
    }))
    .sort((a, b) => b.value - a.value);
}
