import { Search } from "lucide-react";
import { EXPENSE_CATEGORY_OPTIONS } from "@/domain/portfolio/categories";
import { formatDate, formatMoney, formatSignedMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { param, type DashboardData, type SearchParams } from "../../dashboard-data";
import { TransactionCategoryControl } from "../import-controls";
import { SectionCard } from "../ui";

const filterSelectClass =
  "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const fieldLabelClass = "grid gap-1.5";
const fieldSpanClass = "text-[0.74rem] font-medium text-muted-foreground";
const thClass = "text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-muted-foreground";

function shortId(value: string) {
  return value.slice(-8);
}

export function TransactionsTab({ data, params }: { data: DashboardData; params: SearchParams }) {
  const latestImportedBatchId = data.importBatches.find((batch) => batch.status === "IMPORTED")?.id ?? null;

  return (
    <SectionCard
      title="Transactions"
      sub={`${data.filteredCount} rows · ${formatMoney(data.filteredInflow)} inflow · ${formatMoney(data.filteredOutflow)} outflow${
        data.filteredCount > data.transactions.length ? ` · showing latest ${data.transactions.length}` : ""
      }`}
      contentClassName="px-0"
    >
      {/* URL-is-state: a plain GET form, no client JS. Only the chrome is restyled. */}
      <form className="mb-4 grid grid-cols-8 items-end gap-2.5 px-5 max-[1160px]:grid-cols-4 max-[640px]:grid-cols-2" action="/" method="get">
        <input type="hidden" name="tab" value="transactions" />
        <label className={fieldLabelClass}><span className={fieldSpanClass}>From</span><Input name="dateFrom" type="date" defaultValue={param(params, "dateFrom")} /></label>
        <label className={fieldLabelClass}><span className={fieldSpanClass}>To</span><Input name="dateTo" type="date" defaultValue={param(params, "dateTo")} /></label>
        <label className={fieldLabelClass}>
          <span className={fieldSpanClass}>Category</span>
          <select className={filterSelectClass} name="category" defaultValue={param(params, "category")}>
            <option value="">Any</option>
            {EXPENSE_CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className={fieldLabelClass}>
          <span className={fieldSpanClass}>Direction</span>
          <select className={filterSelectClass} name="direction" defaultValue={param(params, "direction")}>
            <option value="">Any</option>
            <option value="INFLOW">Inflow</option>
            <option value="OUTFLOW">Outflow</option>
          </select>
        </label>
        <label className={fieldLabelClass}><span className={fieldSpanClass}>Merchant</span><Input name="merchant" defaultValue={param(params, "merchant")} placeholder="Search descriptions" /></label>
        <label className={fieldLabelClass}><span className={fieldSpanClass}>Min</span><Input name="amountMin" type="number" step="0.01" defaultValue={param(params, "amountMin")} /></label>
        <label className={fieldLabelClass}><span className={fieldSpanClass}>Max</span><Input name="amountMax" type="number" step="0.01" defaultValue={param(params, "amountMax")} /></label>
        <Button variant="outline" type="submit"><Search size={16} aria-hidden="true" /> Filter</Button>
      </form>

      {data.transactions.length > 0 ? (
        <Table className="min-w-[640px]">
          <TableHeader>
            <TableRow>
              <TableHead className={cn("pl-5", thClass)}>Date</TableHead>
              <TableHead className={thClass}>Description</TableHead>
              <TableHead className={thClass}>Category</TableHead>
              <TableHead className={cn("pr-5 text-right", thClass)}>Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.transactions.map((transaction) => {
              const isFresh = transaction.importBatchId === latestImportedBatchId;
              const isInflow = transaction.direction === "INFLOW";

              return (
                <TableRow
                  key={transaction.id}
                  className={cn(isFresh && "bg-brand-soft/40 hover:bg-brand-soft/50 [&>td:first-child]:border-l-2 [&>td:first-child]:border-brand")}
                >
                  <TableCell className="whitespace-nowrap py-2.5 pl-5 align-top tabular-nums text-muted-foreground">{formatDate(transaction.operationDate)}</TableCell>
                  <TableCell className="whitespace-normal py-2.5 align-top">
                    <strong className="font-semibold">{transaction.merchant ?? transaction.description}</strong>
                    <span className="mt-0.5 block text-[0.78rem] text-muted-foreground [overflow-wrap:anywhere]">{transaction.description}</span>
                    <span className="block text-[0.72rem] text-muted-foreground">{transaction.source === "STATEMENT" ? "mBank statement" : "mBank email"} · batch {shortId(transaction.importBatchId)}</span>
                  </TableCell>
                  <TableCell className="min-w-[180px] py-2.5 align-top">
                    <TransactionCategoryControl transactionId={transaction.id} category={transaction.category} />
                  </TableCell>
                  <TableCell className="py-2.5 pr-5 text-right align-top">
                    <span className={cn("whitespace-nowrap font-[650]", isInflow && "text-good")}>
                      {formatSignedMoney(transaction.amount, transaction.direction, transaction.currency)}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : (
        <p className="px-5 text-[0.86rem] text-muted-foreground">No transactions match the current filters.</p>
      )}
    </SectionCard>
  );
}
