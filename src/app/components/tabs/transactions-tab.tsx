import { Search } from "lucide-react";
import { EXPENSE_CATEGORY_OPTIONS } from "@/domain/portfolio/categories";
import { formatDate, formatMoney, formatSignedMoney } from "@/lib/format";
import { param, type DashboardData, type SearchParams } from "../../dashboard-data";
import { TransactionCategoryControl } from "../import-controls";
import { PanelHeading } from "../ui";

function shortId(value: string) {
  return value.slice(-8);
}

export function TransactionsTab({ data, params }: { data: DashboardData; params: SearchParams }) {
  const latestImportedBatchId = data.importBatches.find((batch) => batch.status === "IMPORTED")?.id ?? null;

  return (
    <section className="stack">
      <div className="panel">
        <PanelHeading
          title="Transactions"
          sub={`${data.transactions.length} rows · ${formatMoney(data.filteredInflow)} inflow · ${formatMoney(data.filteredOutflow)} outflow`}
        />
        <form className="filter-grid" action="/" method="get">
          <input type="hidden" name="tab" value="transactions" />
          <label><span>From</span><input name="dateFrom" type="date" defaultValue={param(params, "dateFrom")} /></label>
          <label><span>To</span><input name="dateTo" type="date" defaultValue={param(params, "dateTo")} /></label>
          <label><span>Category</span><select name="category" defaultValue={param(params, "category")}><option value="">Any</option>{EXPENSE_CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label><span>Direction</span><select name="direction" defaultValue={param(params, "direction")}><option value="">Any</option><option value="INFLOW">Inflow</option><option value="OUTFLOW">Outflow</option></select></label>
          <label><span>Merchant</span><input name="merchant" defaultValue={param(params, "merchant")} placeholder="Search descriptions" /></label>
          <label><span>Min</span><input name="amountMin" type="number" step="0.01" defaultValue={param(params, "amountMin")} /></label>
          <label><span>Max</span><input name="amountMax" type="number" step="0.01" defaultValue={param(params, "amountMax")} /></label>
          <button className="secondary-button" type="submit"><Search size={16} aria-hidden="true" /> Filter</button>
        </form>

        {data.transactions.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table transactions-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Description</th>
                  <th scope="col">Category</th>
                  <th scope="col" className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.transactions.map((transaction) => (
                  <tr key={transaction.id} className={transaction.importBatchId === latestImportedBatchId ? "fresh-transaction" : undefined}>
                    <td className="cell-muted cell-date">{formatDate(transaction.operationDate)}</td>
                    <td>
                      <strong>{transaction.merchant ?? transaction.description}</strong>
                      <span className="cell-sub">{transaction.description}</span>
                      <span className="cell-sub cell-faint">mBank email · batch {shortId(transaction.importBatchId)}</span>
                    </td>
                    <td className="cell-category">
                      <TransactionCategoryControl transactionId={transaction.id} category={transaction.category} />
                    </td>
                    <td className="num">
                      <span className={transaction.direction === "INFLOW" ? "amount amount-in" : "amount"}>
                        {formatSignedMoney(transaction.amount, transaction.direction, transaction.currency)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">No transactions match the current filters.</p>
        )}
      </div>
    </section>
  );
}
