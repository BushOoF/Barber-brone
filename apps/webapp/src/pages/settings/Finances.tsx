import { useMemo, useState } from "react";
import { api, type MeResponse } from "../../lib/api";
import { useApi } from "../../hooks/useApi";
import { PageHeader } from "../../components/PageHeader";
import { formatMoney } from "../../lib/format";
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

  const data = useApi(() => api.adminFinances(from, to), [from, to]);
  const barbersQ = useApi(() => api.barbers(), []);
  const barberMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of barbersQ.data?.barbers ?? []) m.set(b.id, b.displayName);
    return m;
  }, [barbersQ.data]);

  const rows = data.data?.rows ?? [];

  const revenue = rows
    .filter((r) => r.status === "SCHEDULED" || r.status === "COMPLETED")
    .reduce((sum, r) => sum + (r._sum.totalPriceMinor ?? 0), 0);
  const bookingsCount = rows
    .filter((r) => r.status !== "DISCARDED_NO_SHOW")
    .reduce((sum, r) => sum + r._count._all, 0);
  const noShows = rows
    .filter((r) => r.status === "DISCARDED_NO_SHOW")
    .reduce((sum, r) => sum + r._count._all, 0);

  const perBarber = useMemo(() => {
    const map = new Map<string, { revenue: number; count: number }>();
    for (const r of rows) {
      if (r.status !== "SCHEDULED" && r.status !== "COMPLETED") continue;
      const cur = map.get(r.barberId) ?? { revenue: 0, count: 0 };
      cur.revenue += r._sum.totalPriceMinor ?? 0;
      cur.count += r._count._all;
      map.set(r.barberId, cur);
    }
    return [...map.entries()].sort((a, b) => b[1].revenue - a[1].revenue);
  }, [rows]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t("fin.title")} subtitle={`${from} → ${to}`} />

      <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-6">
        <div className="grid grid-cols-2 gap-2">
          <DateField label={t("fin.from")} value={from} onChange={setFrom} />
          <DateField label={t("fin.to")} value={to} onChange={setTo} />
        </div>

        <div className="rounded-3xl bg-gradient-to-br from-tg-button to-tg-link p-5 text-tg-buttonText shadow-pop">
          <div className="eyebrow opacity-80">{t("fin.revenue_label")}</div>
          <div className="mt-1 text-4xl font-extrabold tabular-nums">{formatMoney(revenue, me.shop.currency)}</div>
          <div className="mt-2 text-sm opacity-90">
            {bookingsCount} {bookingsCount === 1 ? t("fin.bookings") : t("fin.bookings_plural")} ·{" "}
            {noShows} {noShows === 1 ? t("fin.noshow") : t("fin.noshow_plural")}
          </div>
        </div>

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
                      <div className="text-sm font-bold tabular-nums">
                        {formatMoney(stats.revenue, me.shop.currency)}
                      </div>
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
      </div>
    </div>
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
