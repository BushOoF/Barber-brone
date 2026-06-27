import { useEffect, useMemo, useState } from "react";
import { api, type MeResponse, type ServiceCategory, type ServiceDef } from "../../lib/api";
import { useApi } from "../../hooks/useApi";
import { PageHeader } from "../../components/PageHeader";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { formatDuration, formatMoney } from "../../lib/format";
import { haptic } from "../../lib/telegram";
import { useT, useLang } from "../../state/Lang";
import { localizedServiceName } from "../../lib/i18n";

const CATEGORY_LABELS_KEY: Record<ServiceCategory, "srv.category_adult" | "srv.category_child" | "srv.category_addon"> = {
  HAIRCUT_ADULT: "srv.category_adult",
  HAIRCUT_CHILD: "srv.category_child",
  ADDON: "srv.category_addon",
};

export function ServicesPage({ me }: { me: MeResponse }) {
  const t = useT();
  const list = useApi(() => api.adminAllServices(), []);
  const [addOpen, setAddOpen] = useState(false);

  const grouped = useMemo(() => {
    const all = list.data?.services ?? [];
    return {
      HAIRCUT_ADULT: all.filter((s) => s.category === "HAIRCUT_ADULT"),
      HAIRCUT_CHILD: all.filter((s) => s.category === "HAIRCUT_CHILD"),
      ADDON: all.filter((s) => s.category === "ADDON"),
    };
  }, [list.data]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t("srv.title")}
        subtitle={t("srv.sub")}
        trailing={
          <Button size="sm" onClick={() => setAddOpen(true)}>
            {t("srv.add_style")}
          </Button>
        }
      />

      <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-6">
        {list.status === "loading" ? (
          <>
            <div className="h-36 rounded-2xl shimmer" />
            <div className="h-36 rounded-2xl shimmer" />
          </>
        ) : (
          (["HAIRCUT_ADULT", "HAIRCUT_CHILD", "ADDON"] as const).map((cat) => (
            <CategorySection
              key={cat}
              title={t(CATEGORY_LABELS_KEY[cat])}
              services={grouped[cat]}
              currency={me.shop.currency}
              onChange={() => list.refetch()}
            />
          ))
        )}
      </div>

      <AddServiceSheet open={addOpen} onClose={() => setAddOpen(false)} onAdded={() => list.refetch()} />
    </div>
  );
}

function CategorySection({
  title,
  services,
  currency,
  onChange,
}: {
  title: string;
  services: ServiceDef[];
  currency: string;
  onChange: () => void;
}) {
  const t = useT();
  return (
    <section className="space-y-2">
      <h3 className="eyebrow text-tg-hint">{title}</h3>
      {services.length === 0 ? (
        <div className="rounded-2xl bg-surface-1 p-4 text-center text-xs text-tg-hint ring-1 ring-line-soft">
          {t("srv.empty_in_category")}
        </div>
      ) : (
        services.map((s) => (
          <ServiceEditor key={s.id} service={s} currency={currency} onSaved={onChange} onDeleted={onChange} />
        ))
      )}
    </section>
  );
}

function ServiceEditor({
  service,
  currency,
  onSaved,
  onDeleted,
}: {
  service: ServiceDef;
  currency: string;
  onSaved: () => void;
  onDeleted: () => void;
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

  const markDefault = async () => {
    setBusy(true);
    try {
      await api.adminUpdateService(service.id, { isDefault: true });
      haptic("success");
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (service.isDefault) {
      alert(t("srv.cannot_delete_default"));
      return;
    }
    if (!confirm(t("srv.delete_confirm", { name: service.name }))) return;
    setBusy(true);
    try {
      await api.adminDeleteService(service.id);
      haptic("warning");
      onDeleted();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl bg-surface-1 p-4 ring-1 ring-line-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="truncate text-base font-bold">{localizedServiceName(lang, service.key, service.name)}</div>
            {service.isDefault ? (
              <span className="shrink-0 rounded-full bg-tg-button/15 px-2 py-0.5 eyebrow text-tg-button">
                {t("srv.default_badge")}
              </span>
            ) : null}
          </div>
          <div className="text-xs text-tg-hint">{service.key}</div>
        </div>
        <button
          type="button"
          onClick={() => setIsActive((v) => !v)}
          className={
            "shrink-0 rounded-full px-3 py-1 eyebrow " +
            (isActive ? "bg-success/15 text-success" : "bg-tg-hint/15 text-tg-hint")
          }
        >
          {isActive ? t("common.active") : t("common.off")}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <NumberField label={`${t("srv.price")} (${currency})`} value={price} step={1000} min={0} onChange={setPrice} />
        <NumberField label={t("srv.duration")} value={duration} step={5} min={5} max={480} onChange={setDuration} />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-tg-hint">
        <span>{t("srv.now")} {formatMoney(price, currency)} · {formatDuration(duration)}</span>
        <div className="flex flex-wrap items-center gap-2">
          {service.category !== "ADDON" && !service.isDefault ? (
            <Button size="sm" variant="ghost" onClick={markDefault} disabled={busy}>
              {t("srv.mark_default")}
            </Button>
          ) : null}
          {!service.isDefault ? (
            <Button size="sm" variant="destructive" onClick={remove} disabled={busy}>
              {t("common.delete")}
            </Button>
          ) : null}
          <Button size="sm" onClick={save} disabled={!dirty || busy}>
            {busy ? t("common.saving") : t("common.save")}
          </Button>
        </div>
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
      <span className="mb-1 block eyebrow text-tg-hint">{label}</span>
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

function AddServiceSheet({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ServiceCategory>("HAIRCUT_ADULT");
  const [price, setPrice] = useState(80_000);
  const [duration, setDuration] = useState(40);
  const [isDefault, setIsDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setCategory("HAIRCUT_ADULT");
      setPrice(80_000);
      setDuration(40);
      setIsDefault(false);
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError(t("srv.field_name"));
      return;
    }
    setBusy(true);
    try {
      await api.adminCreateService({
        name: name.trim(),
        category,
        priceMinor: price,
        durationMin: duration,
        isDefault,
      });
      haptic("success");
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
      title={t("srv.add_title")}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button fullWidth onClick={submit} disabled={busy}>
            {busy ? t("common.saving") : t("common.add")}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 pb-2">
        <Field label={t("srv.field_name")}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Fade"
            className="w-full rounded-xl bg-surface-1 px-4 py-3 text-base font-medium ring-1 ring-line-strong focus:outline-none focus:ring-2 focus:ring-tg-button"
          />
        </Field>
        <Field label={t("srv.field_category")}>
          <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-surface-1 p-1 ring-1 ring-line-strong">
            {(["HAIRCUT_ADULT", "HAIRCUT_CHILD", "ADDON"] as const).map((cat) => {
              const active = category === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={
                    "rounded-lg px-2 py-2 text-xs font-bold transition " +
                    (active ? "bg-tg-button text-tg-buttonText shadow-soft" : "text-tg-hint")
                  }
                >
                  {t(CATEGORY_LABELS_KEY[cat])}
                </button>
              );
            })}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label={t("srv.price")} value={price} step={5000} min={0} onChange={setPrice} />
          <NumberField label={t("srv.duration")} value={duration} step={5} min={5} max={480} onChange={setDuration} />
        </div>
        {category !== "ADDON" ? (
          <label className="flex items-center gap-2 rounded-xl bg-surface-1 px-4 py-3 ring-1 ring-line-strong">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="h-5 w-5 accent-tg-button"
            />
            <span className="text-sm font-medium">{t("srv.is_default")}</span>
          </label>
        ) : null}
        {error ? (
          <div className="rounded-xl bg-tg-destructive/10 px-3 py-2 text-sm text-tg-destructive ring-1 ring-tg-destructive/30">
            {error}
          </div>
        ) : null}
      </div>
    </Sheet>
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
