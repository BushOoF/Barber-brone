import { useMemo, useState } from "react";
import { api, type VacationDay } from "../../lib/api";
import { useApi } from "../../hooks/useApi";
import { PageHeader } from "../../components/PageHeader";
import { Sheet } from "../../components/ui/Sheet";
import { Button } from "../../components/ui/Button";
import { useT } from "../../state/Lang";
import { haptic } from "../../lib/telegram";

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function todayKey(): string {
  return dateKey(new Date());
}

interface PendingAdd {
  date: string;
  note: string;
}

export function VacationDaysPage() {
  const t = useT();
  const list = useApi(() => api.adminListVacations(), []);
  const [pendingAdd, setPendingAdd] = useState<PendingAdd | null>(null);
  const [busy, setBusy] = useState(false);

  // Track which dates are vacations as a Set for O(1) lookups in the grid.
  const vacationSet = useMemo(() => new Set((list.data?.vacations ?? []).map((v) => v.date)), [list.data]);
  const noteByDate = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const v of list.data?.vacations ?? []) m.set(v.date, v.note);
    return m;
  }, [list.data]);

  const toggleDay = async (d: string) => {
    if (busy) return;
    haptic("selection");
    if (vacationSet.has(d)) {
      // Confirm + remove
      if (!confirm(t("vac.confirm_remove", { date: d }))) return;
      setBusy(true);
      try {
        await api.adminRemoveVacationByDate(d);
        haptic("warning");
        await list.refetch();
      } finally {
        setBusy(false);
      }
    } else {
      // Open the note sheet for new additions.
      setPendingAdd({ date: d, note: "" });
    }
  };

  const confirmAdd = async () => {
    if (!pendingAdd) return;
    setBusy(true);
    try {
      await api.adminAddVacation(pendingAdd.date, pendingAdd.note.trim() || null);
      haptic("success");
      setPendingAdd(null);
      await list.refetch();
    } finally {
      setBusy(false);
    }
  };

  // Render the current month + the next 5 months so the barber can plan ~half a year ahead.
  const months = useMemo(() => {
    const out: { year: number; month: number }[] = [];
    const base = new Date();
    base.setDate(1);
    for (let i = 0; i < 6; i++) {
      const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
      out.push({ year: d.getFullYear(), month: d.getMonth() });
    }
    return out;
  }, []);

  const sortedVacations = useMemo(
    () => (list.data?.vacations ?? []).slice().sort((a, b) => a.date.localeCompare(b.date)),
    [list.data],
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t("vac.title")} subtitle={t("vac.sub")} />

      <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-6">
        <Legend />
        <p className="text-center text-xs text-tg-hint">{t("vac.tap_to_add")}</p>

        {list.status === "loading" ? (
          <div className="space-y-2">
            <div className="h-72 rounded-2xl shimmer" />
            <div className="h-72 rounded-2xl shimmer" />
          </div>
        ) : (
          <>
            <div className="space-y-4">
              {months.map((m) => (
                <MonthCalendar
                  key={`${m.year}-${m.month}`}
                  year={m.year}
                  month={m.month}
                  vacationSet={vacationSet}
                  onPick={toggleDay}
                />
              ))}
            </div>

            <SelectedList vacations={sortedVacations} noteByDate={noteByDate} />
          </>
        )}
      </div>

      <Sheet
        open={!!pendingAdd}
        onClose={() => setPendingAdd(null)}
        title={pendingAdd ? `${pendingAdd.date} · ${t("vac.add_note_title")}` : ""}
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setPendingAdd(null)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button fullWidth onClick={confirmAdd} disabled={busy}>
              {busy ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        }
      >
        <textarea
          value={pendingAdd?.note ?? ""}
          onChange={(e) => setPendingAdd((p) => (p ? { ...p, note: e.target.value } : p))}
          placeholder={t("vac.add_note_placeholder")}
          rows={3}
          maxLength={200}
          className="w-full resize-none rounded-xl bg-surface-1 px-4 py-3 text-base ring-1 ring-line-strong focus:outline-none focus:ring-2 focus:ring-tg-button"
        />
      </Sheet>
    </div>
  );
}

function Legend() {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center justify-center gap-3 text-[11px] text-tg-hint">
      <LegendChip className="ring-tg-button" label={t("vac.legend_today")} />
      <LegendChip className="bg-tg-destructive text-white" label={t("vac.legend_vacation")} />
      <LegendChip className="opacity-40" label={t("vac.legend_past")} />
    </div>
  );
}

function LegendChip({ label, className }: { label: string; className: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-4 w-4 rounded-md bg-surface-1 ring-1 ring-line-strong ${className}`} />
      <span>{label}</span>
    </span>
  );
}

function MonthCalendar({
  year,
  month,
  vacationSet,
  onPick,
}: {
  year: number;
  month: number;
  vacationSet: Set<string>;
  onPick: (date: string) => void;
}) {
  const t = useT();
  const monthName = useMemo(() => {
    const names = t("vac.month_names").split(",");
    return names[month] ?? "";
  }, [month, t]);

  // Build the grid. We use Monday as the first day of the week (more common in CIS/EU).
  const grid = useMemo(() => {
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    // 0=Sunday … 6=Saturday → convert to Monday-first index (0..6 with Mon=0).
    const lead = (first.getDay() + 6) % 7;
    const cells: (number | null)[] = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let day = 1; day <= daysInMonth; day++) cells.push(day);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [year, month]);

  const today = todayKey();
  const weekdayKeys = [
    "vac.weekday_mon",
    "vac.weekday_tue",
    "vac.weekday_wed",
    "vac.weekday_thu",
    "vac.weekday_fri",
    "vac.weekday_sat",
    "vac.weekday_sun",
  ] as const;

  return (
    <div className="rounded-2xl bg-surface-1 p-3 ring-1 ring-line-soft">
      <div className="mb-2 px-1 text-sm font-bold tabular-nums">{monthName} {year}</div>
      <div className="mb-1 grid grid-cols-7 gap-1 text-center eyebrow text-tg-hint">
        {weekdayKeys.map((k) => (
          <div key={k}>{t(k)}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {grid.map((day, idx) => {
          if (day === null) return <div key={`e-${idx}`} className="aspect-square" />;
          const d = `${year}-${pad(month + 1)}-${pad(day)}`;
          const isPast = d < today;
          const isToday = d === today;
          const isVacation = vacationSet.has(d);
          return (
            <button
              key={d}
              type="button"
              disabled={isPast}
              onClick={() => onPick(d)}
              className={[
                "aspect-square rounded-lg text-sm font-bold tabular-nums transition active:scale-95",
                isVacation
                  ? "bg-tg-destructive text-white shadow-soft"
                  : isPast
                  ? "bg-transparent text-tg-hint opacity-40"
                  : "bg-tg-bg text-tg-text ring-1 ring-line-soft hover:bg-surface-2",
                isToday && !isVacation ? "ring-2 ring-tg-button" : "",
              ].join(" ")}
              aria-label={d}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SelectedList({
  vacations,
  noteByDate,
}: {
  vacations: VacationDay[];
  noteByDate: Map<string, string | null>;
}) {
  const t = useT();
  if (vacations.length === 0) {
    return (
      <div className="rounded-2xl bg-surface-1 p-5 text-center text-sm text-tg-hint ring-1 ring-line-soft">
        {t("vac.empty_hint")}
      </div>
    );
  }
  return (
    <section>
      <h3 className="mb-2 eyebrow text-tg-hint">
        {t("vac.count", { n: vacations.length })}
      </h3>
      <div className="space-y-1.5">
        {vacations.map((v) => {
          const note = noteByDate.get(v.date);
          return (
            <div
              key={v.id}
              className="flex items-center justify-between rounded-xl bg-surface-1 px-4 py-2.5 ring-1 ring-line-soft"
            >
              <div className="min-w-0">
                <div className="text-sm font-bold tabular-nums">{v.date}</div>
                {note ? <div className="truncate text-[11px] text-tg-hint">{note}</div> : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
