import { useMemo, useState } from "react";
import { api, type FinanceEntry, type MeResponse } from "../../lib/api";
import { useApi } from "../../hooks/useApi";
import { PageHeader } from "../../components/PageHeader";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { formatMoney, formatDayKey } from "../../lib/format";
import { haptic } from "../../lib/telegram";
import { useT } from "../../state/Lang";

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 86_400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}

export function FinancesPage({ me }: { me: MeResponse }) {
  const t = useT();
  const initial = defaultRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [addOpen, setAddOpen] = useState(false);

  const data = useApi(() => api.adminFinances(from, to), [from, to]);
  const entriesQ = useApi(() => api.adminFinanceEntries(), []);
  const barbersQ = useApi(() => api.barbers(), []);
  const barberMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of barbersQ.data?.barbers ?? []) m.set(b.id, b.displayName);
    return m;
  }, [barbersQ.data]);

  const rows = data.data?.rows ?? [];
  const cur = me.shop.currency;

  const revenue = rows
    .filter((r) => r.status === "SCHEDULED" || r.status === "COMPLETED")
    .reduce((sum, r) => sum + (r._sum.totalPriceMinor ?? 0), 0);
  const bookingsCount = rows
    .filter((r) => r.status !== "DISCARDED_NO_SHOW")
    .reduce((sum, r) => sum + r._count._all, 0);
  const noShows = rows
    .filter((r) => r.status === "DISCARDED_NO_SHOW")
    .reduce((sum, r) => sum + r._count._all, 0);

  const otherIncome = data.data?.manualIncomeMinor ?? 0;
  const expenses = data.data?.manualExpenseMinor ?? 0;
  const net = revenue + otherIncome - expenses;

  const perBarber = useMemo(() => {
    const map = new Map<string, { revenue: number; count: number }>();
    for (const r of rows) {
      if (r.status !== "SCHEDULED" && r.status !== "COMPLETED") continue;
      const c = map.get(r.barberId) ?? { revenue: 0, count: 0 };
      c.revenue += r._sum.totalPriceMinor ?? 0;
      c.count += r._count._all;
      map.set(r.barberId, c);
    }
    return [...map.entries()].sort((a, b) => b[1].revenue - a[1].revenue);
  }, [rows]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t("fin.title")}
        subtitle={`${from} → ${to}`}
        trailing={
          <Button size="sm" onClick={() => setAddOpen(true)}>
            {t("fin.add_btn")}
          </Button>
        }
      />

      <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-6">
        <div className="grid grid-cols-2 gap-2">
          <DateField label={t("fin.from")} value={from} onChange={setFrom} />
          <DateField label={t("fin.to")} value={to} onChange={setTo} />
        </div>

        {/* Net profit headline + breakdown */}
        <div className="rounded-3xl bg-gradient-to-br from-tg-button to-tg-link p-5 text-tg-buttonText shadow-pop">
          <div className="eyebrow opacity-80">{t("fin.net")}</div>
          <div className="mt-1 text-4xl font-extrabold tabular-nums">{formatMoney(net, cur)}</div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Stat label={t("fin.revenue_short")} value={formatMoney(revenue, cur)} />
            <Stat label={t("fin.other_income")} value={`+ ${formatMoney(otherIncome, cur)}`} />
            <Stat label={t("fin.expenses")} value={`− ${formatMoney(expenses, cur)}`} />
          </div>
          <div className="mt-2 text-xs opacity-90">
            {bookingsCount} {bookingsCount === 1 ? t("fin.bookings") : t("fin.bookings_plural")} ·{" "}
            {noShows} {noShows === 1 ? t("fin.noshow") : t("fin.noshow_plural")}
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* By barber */}
          <section>
            <h3 className="mb-2 eyebrow text-tg-hint">{t("fin.by_barber")}</h3>
            {perBarber.length === 0 ? (
              <div className="rounded-2xl bg-surface-1 p-6 text-center text-sm text-tg-hint ring-1 ring-line-soft">
                {t("fin.no_data")}
              </div>
            ) : (
              <div className="space-y-2">
                {perBarber.map(([barberId, stats]) => {
                  const max = perBarber[0][1].revenue || 1;
                  const pct = Math.max(4, Math.round((stats.revenue / max) * 100));
                  return (
                    <div key={barberId} className="rounded-2xl bg-surface-1 p-3 ring-1 ring-line-soft">
                      <div className="flex items-baseline justify-between">
                        <div className="text-sm font-bold">{barberMap.get(barberId) ?? barberId}</div>
                        <div className="text-sm font-bold tabular-nums">{formatMoney(stats.revenue, cur)}</div>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-tg-bg ring-1 ring-line-soft">
                        <div className="h-full rounded-full bg-tg-button" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="mt-1 text-[11px] text-tg-hint">
                        {stats.count} {stats.count === 1 ? t("fin.bookings") : t("fin.bookings_plural")}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Manual income / expense entries */}
          <section>
            <h3 className="mb-2 eyebrow text-tg-hint">{t("fin.entries_title")}</h3>
            {(entriesQ.data?.entries.length ?? 0) === 0 ? (
              <div className="rounded-2xl bg-surface-1 p-6 text-center text-sm text-tg-hint ring-1 ring-line-soft">
                {t("fin.no_entries")}
              </div>
            ) : (
              <div className="space-y-2">
                {entriesQ.data?.entries.map((e) => (
                  <EntryRow key={e.id} e={e} currency={cur} onDeleted={() => { entriesQ.refetch(); data.refetch(); }} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <AddEntrySheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={() => {
          entriesQ.refetch();
          data.refetch();
        }}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/10 px-2 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-0.5 text-xs font-bold tabular-nums">{value}</div>
    </div>
  );
}

function EntryRow({ e, currency, onDeleted }: { e: FinanceEntry; currency: string; onDeleted: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const isIncome = e.kind === "INCOME";

  const remove = async () => {
    if (!confirm(t("fin.delete_confirm"))) return;
    setBusy(true);
    try {
      await api.adminDeleteFinanceEntry(e.id);
      haptic("warning");
      onDeleted();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-surface-1 p-3 ring-1 ring-line-soft">
      <div
        className={
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base " +
          (isIncome ? "bg-success/15 text-success" : "bg-tg-destructive/15 text-tg-destructive")
        }
      >
        {isIncome ? "↑" : "↓"}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{e.note || (isIncome ? t("fin.income") : t("fin.expense"))}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-tg-hint">
          <span>{e.date}</span>
          {e.repeatEveryDays ? (
            <span className="rounded-full bg-tg-button/10 px-1.5 py-0.5 font-semibold text-tg-button">
              🔁 {t("fin.repeat_summary", { n: e.repeatEveryDays })}
            </span>
          ) : null}
        </div>
      </div>
      <div className={"shrink-0 text-sm font-bold tabular-nums " + (isIncome ? "text-success" : "text-tg-destructive")}>
        {isIncome ? "+" : "−"}
        {formatMoney(e.amountMinor, currency)}
      </div>
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        className="shrink-0 rounded-lg px-2 py-1 text-tg-hint hover:text-tg-destructive disabled:opacity-50"
        aria-label="delete"
      >
        ✕
      </button>
    </div>
  );
}

function AddEntrySheet({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const t = useT();
  const [kind, setKind] = useState<"INCOME" | "EXPENSE">("EXPENSE");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(formatDayKey());
  const [repeats, setRepeats] = useState(false);
  const [everyDays, setEveryDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setKind("EXPENSE");
    setAmount("");
    setNote("");
    setDate(formatDayKey());
    setRepeats(false);
    setEveryDays("30");
    setError(null);
  };

  const submit = async () => {
    setError(null);
    const amountMinor = parseInt(amount.replace(/\D/g, ""), 10);
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      setError(t("fin.err_amount"));
      return;
    }
    const repeatEveryDays = repeats ? Math.max(1, parseInt(everyDays, 10) || 0) : null;
    setBusy(true);
    try {
      await api.adminAddFinanceEntry({ kind, amountMinor, note: note.trim() || null, date, repeatEveryDays });
      haptic("success");
      reset();
      onAdded();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("fin.add_title")}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button fullWidth onClick={submit} disabled={busy}>
            {busy ? t("common.saving") : t("common.add")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Income / Expense toggle */}
        <div>
          <span className="mb-1 block eyebrow text-tg-hint">{t("fin.kind")}</span>
          <div className="grid grid-cols-2 gap-2">
            <ToggleButton active={kind === "INCOME"} onClick={() => setKind("INCOME")} tone="success">
              ↑ {t("fin.income")}
            </ToggleButton>
            <ToggleButton active={kind === "EXPENSE"} onClick={() => setKind("EXPENSE")} tone="destructive">
              ↓ {t("fin.expense")}
            </ToggleButton>
          </div>
        </div>

        <Field label={t("fin.amount")}>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="numeric"
            placeholder="0"
            className="w-full rounded-xl bg-surface-1 px-4 py-3 text-base font-semibold tabular-nums ring-1 ring-line-strong focus:outline-none focus:ring-2 focus:ring-tg-button"
          />
        </Field>

        <Field label={t("fin.note")}>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            className="w-full rounded-xl bg-surface-1 px-4 py-3 text-base font-medium ring-1 ring-line-strong focus:outline-none focus:ring-2 focus:ring-tg-button"
          />
        </Field>

        <Field label={t("fin.date")}>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-xl bg-surface-1 px-3 py-3 text-base font-semibold ring-1 ring-line-strong focus:outline-none focus:ring-2 focus:ring-tg-button"
          />
        </Field>

        {/* Recurrence */}
        <div>
          <span className="mb-1 block eyebrow text-tg-hint">{t("fin.recurrence")}</span>
          <div className="grid grid-cols-2 gap-2">
            <ToggleButton active={!repeats} onClick={() => setRepeats(false)} tone="button">
              {t("fin.one_time")}
            </ToggleButton>
            <ToggleButton active={repeats} onClick={() => setRepeats(true)} tone="button">
              🔁 {t("fin.repeats")}
            </ToggleButton>
          </div>
          {repeats ? (
            <div className="mt-2 flex items-center gap-2 text-sm">
              <span className="text-tg-hint">{t("fin.every")}</span>
              <input
                value={everyDays}
                onChange={(e) => setEveryDays(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                className="w-20 rounded-xl bg-surface-1 px-3 py-2 text-center text-base font-semibold tabular-nums ring-1 ring-line-strong focus:outline-none focus:ring-2 focus:ring-tg-button"
              />
              <span className="text-tg-hint">{t("fin.days")}</span>
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="rounded-xl bg-tg-destructive/10 px-3 py-2 text-sm text-tg-destructive ring-1 ring-tg-destructive/30">
            {error}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

function ToggleButton({
  active,
  onClick,
  tone,
  children,
}: {
  active: boolean;
  onClick: () => void;
  tone: "success" | "destructive" | "button";
  children: React.ReactNode;
}) {
  const activeCls =
    tone === "success"
      ? "bg-success/15 text-success ring-success/40"
      : tone === "destructive"
      ? "bg-tg-destructive/15 text-tg-destructive ring-tg-destructive/40"
      : "bg-tg-button/15 text-tg-button ring-tg-button/40";
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-xl px-3 py-2.5 text-sm font-bold ring-1 transition active:scale-[0.98] " +
        (active ? activeCls : "bg-surface-1 text-tg-hint ring-line-strong")
      }
    >
      {children}
    </button>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block eyebrow text-tg-hint">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl bg-surface-1 px-3 py-2.5 text-sm font-semibold ring-1 ring-line-strong focus:outline-none focus:ring-2 focus:ring-tg-button"
      />
    </label>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block eyebrow text-tg-hint">{label}</span>
      {children}
    </label>
  );
}
