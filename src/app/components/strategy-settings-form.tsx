"use client";

import { useActionState, useEffect, useMemo } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2, Save, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { updateStrategyAction, type ActionResult } from "../actions";
import type { AssetClass, StrategyMemory } from "@/domain/portfolio/types";
import { ActionStatus } from "./action-status";
import { SectionCard } from "./ui";

const initialState: ActionResult = {
  status: "idle",
  message: ""
};

const fieldLabel = "grid gap-1.5";
const fieldSpan = "text-[0.74rem] font-medium text-muted-foreground";
const selectClass =
  "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const row3 = "grid grid-cols-3 gap-3 max-[640px]:grid-cols-2";
const row2 = "grid grid-cols-2 gap-3";

function SaveButton() {
  const { pending } = useFormStatus();

  return (
    <Button variant="outline" type="submit" disabled={pending} aria-busy={pending}>
      {pending ? <Loader2 className="animate-spin" size={16} aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
      {pending ? "Saving profile" : "Save profile"}
    </Button>
  );
}

function nullableNumber(value: number | null) {
  return value ?? "";
}

export function StrategySettingsForm({ strategy }: { strategy: StrategyMemory }) {
  const [state, formAction] = useActionState(updateStrategyAction, initialState);
  const router = useRouter();
  const strategyAllocation = useMemo(
    () => Object.entries(strategy.targetAllocation) as Array<[AssetClass, number]>,
    [strategy.targetAllocation]
  );
  const targetAllocationTotal = strategyAllocation.reduce((sum, [, value]) => sum + value, 0);

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
    }
  }, [router, state.status, state.timestamp]);

  return (
    <SectionCard
      title="Financial profile"
      sub="Local source of truth for reports and strategy suggestions"
      action={<SlidersHorizontal size={18} aria-hidden="true" />}
    >
      <form action={formAction} className="grid gap-4">
        <div className={row3}>
          <label className={fieldLabel}>
            <span className={fieldSpan}>Profile name</span>
            <Input name="profile" defaultValue={strategy.profile} required maxLength={80} />
          </label>
          <label className={fieldLabel}>
            <span className={fieldSpan}>Life stage</span>
            <Input name="lifeStage" defaultValue={strategy.lifeStage} required maxLength={80} />
          </label>
          <label className={fieldLabel}>
            <span className={fieldSpan}>Age</span>
            <Input name="age" type="number" min="0" max="120" defaultValue={nullableNumber(strategy.age)} />
          </label>
        </div>

        <div className={row3}>
          <label className={fieldLabel}>
            <span className={fieldSpan}>Horizon years</span>
            <Input name="investmentHorizonYears" type="number" min="1" max="80" defaultValue={strategy.investmentHorizonYears} required />
          </label>
          <label className={fieldLabel}>
            <span className={fieldSpan}>Risk tolerance</span>
            <select className={selectClass} name="riskTolerance" defaultValue={strategy.riskTolerance}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="very_high">Very high</option>
            </select>
          </label>
          <label className={fieldLabel}>
            <span className={fieldSpan}>Report length</span>
            <select className={selectClass} name="preferredReportLength" defaultValue={strategy.preferredReportLength}>
              <option value="short">Short</option>
              <option value="medium">Medium</option>
              <option value="long">Long</option>
            </select>
          </label>
        </div>

        <div className={row3}>
          <label className={fieldLabel}>
            <span className={fieldSpan}>Monthly income</span>
            <Input name="monthlyIncome" type="number" min="0" step="1" defaultValue={nullableNumber(strategy.monthlyIncome)} />
          </label>
          <label className={fieldLabel}>
            <span className={fieldSpan}>Fixed costs</span>
            <Input name="monthlyFixedCosts" type="number" min="0" step="1" defaultValue={nullableNumber(strategy.monthlyFixedCosts)} />
          </label>
          <label className={fieldLabel}>
            <span className={fieldSpan}>Investment capacity</span>
            <Input name="monthlyInvestmentCapacity" type="number" min="0" step="1" defaultValue={nullableNumber(strategy.monthlyInvestmentCapacity)} />
          </label>
        </div>

        <div className={row2}>
          <label className={fieldLabel}>
            <span className={fieldSpan}>Goals</span>
            <Textarea name="goals" defaultValue={strategy.goals.join("\n")} rows={5} />
          </label>
          <label className={fieldLabel}>
            <span className={fieldSpan}>Constraints</span>
            <Textarea name="constraints" defaultValue={strategy.constraints.join("\n")} rows={5} />
          </label>
        </div>

        <div className={row2}>
          <label className={fieldLabel}>
            <span className={fieldSpan}>Base currency</span>
            <Input name="baseCurrencyDisplay" value="PLN" readOnly />
          </label>
          <label className={fieldLabel}>
            <span className={fieldSpan}>Report language</span>
            <select className={selectClass} name="preferredReportLanguage" defaultValue={strategy.preferredReportLanguage}>
              <option value="pl">Polski</option>
              <option value="en">English</option>
            </select>
          </label>
        </div>

        <details className="rounded-md border border-border bg-secondary p-3.5 [&[open]_summary]:mb-3">
          <summary className="flex cursor-pointer items-center justify-between gap-3 text-[0.88rem] font-semibold">
            <span>Portfolio guardrails</span>
            <strong className={targetAllocationTotal === 100 ? "text-good" : "text-warn"}>{targetAllocationTotal}%</strong>
          </summary>
          <div className="grid grid-cols-4 gap-3 max-[640px]:grid-cols-2">
            {strategyAllocation.map(([assetClass, value]) => (
              <label className={fieldLabel} key={assetClass}>
                <span className={fieldSpan}>{assetClass}</span>
                <Input name={assetClass} type="number" min="0" max="100" step="1" defaultValue={value} required />
              </label>
            ))}
          </div>
          <div className={cn(row3, "mt-3")}>
            <label className={fieldLabel}>
              <span className={fieldSpan}>Max single position</span>
              <Input name="maxSinglePositionPercent" type="number" min="1" max="100" step="1" defaultValue={strategy.maxSinglePositionPercent} required />
            </label>
            <label className={fieldLabel}>
              <span className={fieldSpan}>Max crypto</span>
              <Input name="maxCryptoPercent" type="number" min="0" max="100" step="1" defaultValue={strategy.maxCryptoPercent} required />
            </label>
            <label className={fieldLabel}>
              <span className={fieldSpan}>Min cash</span>
              <Input name="minCashPercent" type="number" min="0" max="100" step="1" defaultValue={strategy.minCashPercent} required />
            </label>
          </div>
        </details>

        <div className="flex flex-wrap items-start gap-3">
          <SaveButton />
          <ActionStatus state={state} />
        </div>
      </form>
    </SectionCard>
  );
}
