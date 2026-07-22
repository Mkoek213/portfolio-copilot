"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2, Save, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BUDGET_CATEGORY_OPTIONS } from "@/domain/portfolio/categories";
import { updateCategoryBudgetsAction, type ActionResult } from "../actions";
import { ActionStatus } from "./action-status";
import { SectionCard } from "./ui";

/**
 * Plan-20 monthly PLN cap per expense category. A blank input means the
 * category is untracked, which is also how a budget is cleared. Follows the
 * repo's Server Action form contract: `useActionState` + `<form action={...}>`
 * + `useFormStatus()` pending + `router.refresh()` on success + `ActionStatus`.
 */

const initialState: ActionResult = {
  status: "idle",
  message: ""
};

function SaveButton() {
  const { pending } = useFormStatus();

  return (
    <Button variant="outline" type="submit" name="saveBudgets" disabled={pending} aria-busy={pending}>
      {pending ? <Loader2 className="animate-spin" size={16} aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
      {pending ? "Saving budgets" : "Save budgets"}
    </Button>
  );
}

export function CategoryBudgetsForm({ budgets }: { budgets: Array<{ category: string; amount: number }> }) {
  const [state, formAction] = useActionState(updateCategoryBudgetsAction, initialState);
  const router = useRouter();
  const amounts = new Map(budgets.map((budget) => [budget.category, budget.amount]));

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
    }
  }, [router, state.status, state.timestamp]);

  return (
    <SectionCard
      title="Category budgets"
      sub="Monthly PLN cap per category · blank means untracked"
      action={<Wallet size={18} aria-hidden="true" />}
      // The budgets sit on their own row under the profile and suggestions, so
      // the twelve inputs get the full width instead of a half-empty row.
      className="col-span-2 max-[1160px]:col-span-1"
    >
      <form action={formAction} className="grid gap-4">
        <div className="grid grid-cols-4 gap-3 max-[900px]:grid-cols-3 max-[640px]:grid-cols-2">
          {BUDGET_CATEGORY_OPTIONS.map((option) => (
            <label className="grid gap-1.5" key={option.value}>
              <span className="text-[0.74rem] font-medium text-muted-foreground">{option.label}</span>
              <Input
                name={`budget-${option.value}`}
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                placeholder="brak"
                defaultValue={amounts.get(option.value) ?? ""}
              />
            </label>
          ))}
        </div>

        <div className="flex flex-wrap items-start gap-3">
          <SaveButton />
          <ActionStatus state={state} />
        </div>
      </form>
    </SectionCard>
  );
}
