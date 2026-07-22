import type { ExpenseCategory } from "./types";

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "food",
  "housing",
  "transport",
  "education",
  "subscriptions",
  "health",
  "entertainment",
  "investments",
  "shopping",
  "people_transfers",
  "income",
  "fees",
  "other"
];

export const EXPENSE_CATEGORY_OPTIONS: Array<{ value: ExpenseCategory; label: string }> = [
  { value: "food", label: "jedzenie" },
  { value: "housing", label: "mieszkanie" },
  { value: "transport", label: "transport" },
  { value: "education", label: "edukacja" },
  { value: "subscriptions", label: "subskrypcje" },
  { value: "health", label: "zdrowie" },
  { value: "entertainment", label: "rozrywka" },
  { value: "investments", label: "inwestycje" },
  { value: "shopping", label: "zakupy" },
  { value: "people_transfers", label: "przelewy do ludzi" },
  { value: "income", label: "przychody" },
  { value: "fees", label: "oplaty" },
  { value: "other", label: "inne" }
];

// A budget caps spending, so the inflow bucket is never budgetable (plan 20).
export const BUDGET_CATEGORY_OPTIONS = EXPENSE_CATEGORY_OPTIONS.filter((option) => option.value !== "income");

export function isExpenseCategory(value: string): value is ExpenseCategory {
  return EXPENSE_CATEGORIES.includes(value as ExpenseCategory);
}

export function expenseCategoryLabel(value: string) {
  return EXPENSE_CATEGORY_OPTIONS.find((option) => option.value === value)?.label ?? value;
}
