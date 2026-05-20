import { useEffect, useState } from "react";
import { api, type MeResponse, type ServiceDef } from "../../lib/api";
import { useApi } from "../../hooks/useApi";
import { PageHeader } from "../../components/PageHeader";
import { Button } from "../../components/ui/Button";
import { formatDuration, formatMoney } from "../../lib/format";
import { haptic } from "../../lib/telegram";
import { useT, useLang } from "../../state/Lang";
import { localizedServiceName } from "../../lib/i18n";

export function ServicesPage({ me }: { me: MeResponse }) {
  const t = useT();
  // Admin endpoint returns ALL services (including inactive) so toggled-off rows don't vanish.
  const list = useApi(() => api.adminAllServices(), []);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t("srv.title")} subtitle={t("srv.sub")} />

      <div className="flex-1 space-y-2 overflow-y-auto px-5 pb-6">
        {list.status === "loading" ? (
          <>
            <div className="h-36 rounded-2xl shimmer" />
            <div className="h-36 rounded-2xl shimmer" />
            <div className="h-36 rounded-2xl shimmer" />
          </>
        ) : (
          list.data?.services.map((s) => (
            <ServiceEditor key={s.id} service={s} currency={me.shop.currency} onSaved={() => list.refetch()} />
          ))
        )}
      </div>
    </div>
  );
}

function ServiceEditor({
  service,
  currency,
  onSaved,
}: {
  service: ServiceDef;
  currency: string;
  onSaved: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const [price, setPrice] = useState(service.priceMinor);
  const [duration, setDuration] = useState(service.durationMin);
  const [isActive, setIsActive] = useState(service.isActive);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPrice(service.priceMinor);
    setDuration(service.durationMin);
    setIsActive(service.isActive);
  }, [service.id, service.priceMinor, service.durationMin, service.isActive]);

  const dirty =
    price !== service.priceMinor || duration !== service.durationMin || isActive !== service.isActive;

  const save = async () => {
    setBusy(true);
    try {
      await api.adminUpdateService(service.id, {
        priceMinor: price,
        durationMin: duration,
        isActive,
      });
      haptic("success");
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl bg-surface-1 p-4 ring-1 ring-line-soft">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-bold">{localizedServiceName(lang, service.key, service.name)}</div>
          <div className="text-xs text-tg-hint">{service.key}</div>
        </div>
        <button
          type="button"
          onClick={() => setIsActive((v) => !v)}
          className={
            "shrink-0 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider " +
            (isActive ? "bg-emerald-500/15 text-emerald-600" : "bg-tg-hint/15 text-tg-hint")
          }
        >
          {isActive ? t("common.active") : t("common.off")}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <NumberField
          label={`${t("srv.price")} (${currency})`}
          value={price}
          step={1000}
          min={0}
          onChange={setPrice}
        />
        <NumberField label={t("srv.duration")} value={duration} step={5} min={5} max={480} onChange={setDuration} />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-tg-hint">
        <span>
          {t("srv.now")} {formatMoney(price, currency)} · {formatDuration(duration)}
        </span>
        <Button size="sm" onClick={save} disabled={!dirty || busy}>
          {busy ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step: number;
  min: number;
  max?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-tg-hint">{label}</span>
      <div className="flex items-center gap-1 rounded-xl bg-tg-bg ring-1 ring-line-strong">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - step))}
          className="flex h-11 w-10 items-center justify-center text-lg font-bold active:scale-95"
        >
          −
        </button>
        <input
          type="number"
          value={value}
          onChange={(e) =>
            onChange(Math.max(min, Math.min(max ?? Number.POSITIVE_INFINITY, Number(e.target.value) || 0)))
          }
          className="h-11 flex-1 bg-transparent text-center text-base font-bold tabular-nums focus:outline-none"
        />
        <button
          type="button"
          onClick={() => onChange(Math.min(max ?? Number.POSITIVE_INFINITY, value + step))}
          className="flex h-11 w-10 items-center justify-center text-lg font-bold active:scale-95"
        >
          +
        </button>
      </div>
    </label>
  );
}
