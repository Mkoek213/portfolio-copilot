"use client";

import { useEffect, useMemo } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2, Save, SlidersHorizontal } from "lucide-react";
import { updateStrategyAction, type ActionResult } from "../actions";
import type { AssetClass, StrategyMemory } from "@/domain/portfolio/types";
import { ActionStatus } from "./action-status";

const initialState: ActionResult = {
  status: "idle",
  message: ""
};

function SaveButton() {
  const { pending } = useFormStatus();

  return (
    <button className="secondary-button" type="submit" disabled={pending} aria-busy={pending}>
      {pending ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Save size={18} aria-hidden="true" />}
      {pending ? "Saving profile" : "Save profile"}
    </button>
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
    <div className="panel strategy-panel">
      <div className="panel-heading">
        <div>
          <h2>Financial profile</h2>
          <span>Local source of truth for reports and strategy suggestions</span>
        </div>
        <SlidersHorizontal aria-hidden="true" />
      </div>
      <form action={formAction} className="strategy-form">
        <div className="form-row profile-row">
          <label>
            <span>Profile name</span>
            <input name="profile" defaultValue={strategy.profile} required maxLength={80} />
          </label>
          <label>
            <span>Life stage</span>
            <input name="lifeStage" defaultValue={strategy.lifeStage} required maxLength={80} />
          </label>
          <label>
            <span>Age</span>
            <input name="age" type="number" min="0" max="120" defaultValue={nullableNumber(strategy.age)} />
          </label>
        </div>

        <div className="form-row profile-row">
          <label>
            <span>Horizon years</span>
            <input name="investmentHorizonYears" type="number" min="1" max="80" defaultValue={strategy.investmentHorizonYears} required />
          </label>
          <label>
            <span>Risk tolerance</span>
            <select name="riskTolerance" defaultValue={strategy.riskTolerance}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="very_high">Very high</option>
            </select>
          </label>
          <label>
            <span>Report length</span>
            <select name="preferredReportLength" defaultValue={strategy.preferredReportLength}>
              <option value="short">Short</option>
              <option value="medium">Medium</option>
              <option value="long">Long</option>
            </select>
          </label>
        </div>

        <div className="form-row profile-row">
          <label>
            <span>Monthly income</span>
            <input name="monthlyIncome" type="number" min="0" step="1" defaultValue={nullableNumber(strategy.monthlyIncome)} />
          </label>
          <label>
            <span>Fixed costs</span>
            <input name="monthlyFixedCosts" type="number" min="0" step="1" defaultValue={nullableNumber(strategy.monthlyFixedCosts)} />
          </label>
          <label>
            <span>Investment capacity</span>
            <input name="monthlyInvestmentCapacity" type="number" min="0" step="1" defaultValue={nullableNumber(strategy.monthlyInvestmentCapacity)} />
          </label>
        </div>

        <div className="form-row text-row">
          <label>
            <span>Goals</span>
            <textarea name="goals" defaultValue={strategy.goals.join("\n")} rows={5} />
          </label>
          <label>
            <span>Constraints</span>
            <textarea name="constraints" defaultValue={strategy.constraints.join("\n")} rows={5} />
          </label>
        </div>

        <div className="form-row compact-row">
          <label>
            <span>Base currency</span>
            <input name="baseCurrencyDisplay" value="PLN" readOnly />
          </label>
          <label>
            <span>Report language</span>
            <select name="preferredReportLanguage" defaultValue={strategy.preferredReportLanguage}>
              <option value="pl">Polski</option>
              <option value="en">English</option>
            </select>
          </label>
        </div>

        <details className="guardrail-details">
          <summary>
            <span>Portfolio guardrails</span>
            <strong className={targetAllocationTotal === 100 ? "ok" : "warn"}>{targetAllocationTotal}%</strong>
          </summary>
          <div className="form-section">
            <div className="allocation-input-grid">
              {strategyAllocation.map(([assetClass, value]) => (
                <label key={assetClass}>
                  <span>{assetClass}</span>
                  <input name={assetClass} type="number" min="0" max="100" step="1" defaultValue={value} required />
                </label>
              ))}
            </div>
          </div>
          <div className="form-row">
            <label>
              <span>Max single position</span>
              <input
                name="maxSinglePositionPercent"
                type="number"
                min="1"
                max="100"
                step="1"
                defaultValue={strategy.maxSinglePositionPercent}
                required
              />
            </label>
            <label>
              <span>Max crypto</span>
              <input name="maxCryptoPercent" type="number" min="0" max="100" step="1" defaultValue={strategy.maxCryptoPercent} required />
            </label>
            <label>
              <span>Min cash</span>
              <input name="minCashPercent" type="number" min="0" max="100" step="1" defaultValue={strategy.minCashPercent} required />
            </label>
          </div>
        </details>

        <div className="form-actions">
          <SaveButton />
          <ActionStatus state={state} />
        </div>
      </form>
    </div>
  );
}
