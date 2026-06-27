import { useState } from "react";
import { api, type Apprentice, type MeResponse } from "../../lib/api";
import { useApi } from "../../hooks/useApi";
import { PageHeader } from "../../components/PageHeader";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { haptic } from "../../lib/telegram";
import { useT } from "../../state/Lang";

export function ApprenticesPage({ me: _me }: { me: MeResponse }) {
  const t = useT();
  const list = useApi(() => api.adminListApprentices(), []);
  const [addOpen, setAddOpen] = useState(false);
  const [blockTarget, setBlockTarget] = useState<Apprentice | null>(null);

  const count = list.data?.apprentices.length ?? 0;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t("apr.title")}
        subtitle={`${count} ${t("apr.total")}`}
        trailing={
          <Button size="sm" onClick={() => setAddOpen(true)}>
            {t("apr.add_btn")}
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto px-5 pb-6">
        {list.status === "loading" ? (
          <div className="space-y-2">
            <div className="h-16 rounded-2xl shimmer" />
            <div className="h-16 rounded-2xl shimmer" />
          </div>
        ) : list.data?.apprentices.length === 0 ? (
          <EmptyState onAdd={() => setAddOpen(true)} />
        ) : (
          <div className="space-y-2">
            {list.data?.apprentices.map((a) => (
              <ApprenticeRow key={a.id} a={a} onChanged={() => list.refetch()} onBlock={() => setBlockTarget(a)} />
            ))}
          </div>
        )}
      </div>

      <AddApprenticeSheet open={addOpen} onClose={() => setAddOpen(false)} onAdded={() => list.refetch()} />
      <BlockOutSheet
        target={blockTarget}
        onClose={() => setBlockTarget(null)}
        onSaved={() => {
          setBlockTarget(null);
          list.refetch();
        }}
      />
    </div>
  );
}

function ApprenticeRow({
  a,
  onChanged,
  onBlock,
}: {
  a: Apprentice;
  onChanged: () => void;
  onBlock: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  const toggleActive = async () => {
    setBusy(true);
    try {
      await api.adminUpdateApprentice(a.id, { isActive: !a.isActive });
      haptic("success");
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(t("apr.delete_confirm", { name: a.displayName }))) return;
    setBusy(true);
    try {
      await api.adminDeleteApprentice(a.id);
      haptic("warning");
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl bg-surface-1 p-4 ring-1 ring-line-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold">{a.displayName}</div>
          <div className="mt-0.5 text-xs text-tg-hint">
            {a.user?.username ? `@${a.user.username} · ` : ""}
            {a.user?.phone ?? "—"}
          </div>
          {a.user && a.user.telegramId == null ? (
            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning">
              ⏳ {t("apr.pending")}
            </div>
          ) : null}
        </div>
        <span
          className={
            "shrink-0 rounded-full px-2.5 py-1 eyebrow " +
            (a.isActive ? "bg-success/15 text-success" : "bg-tg-hint/15 text-tg-hint")
          }
        >
          {a.isActive ? t("common.active") : t("common.off")}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={onBlock} disabled={busy || !a.isActive}>
          {t("apr.block_btn")}
        </Button>
        <Button size="sm" variant={a.isActive ? "ghost" : "primary"} onClick={toggleActive} disabled={busy}>
          {a.isActive ? t("apr.deactivate") : t("apr.activate")}
        </Button>
        <Button size="sm" variant="destructive" onClick={remove} disabled={busy}>
          {t("apr.delete_btn")}
        </Button>
      </div>
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  const t = useT();
  return (
    <div className="mt-8 rounded-3xl bg-surface-1 p-8 text-center ring-1 ring-line-soft">
      <div className="text-5xl">✂️</div>
      <h2 className="mt-3 text-lg font-bold">{t("apr.empty_title")}</h2>
      <p className="mt-1 text-sm text-tg-hint">{t("apr.empty_hint")}</p>
      <div className="mt-4 inline-flex">
        <Button onClick={onAdd}>{t("apr.add_btn")}</Button>
      </div>
    </div>
  );
}

function AddApprenticeSheet({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const t = useT();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    // Accept any reasonable phone format; the server matches on the last 9 digits.
    if (phone.replace(/\D/g, "").length < 7) {
      setError(t("apr.add_err_id"));
      return;
    }
    if (name.trim().length < 1) {
      setError(t("apr.add_err_name"));
      return;
    }
    setBusy(true);
    try {
      await api.adminAddApprentice(phone.trim(), name.trim());
      haptic("success");
      setPhone("");
      setName("");
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
      title={t("apr.add_title")}
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
      <p className="mb-4 text-sm text-tg-hint">{t("apr.add_hint")}</p>
      <div className="space-y-3">
        <Field label={t("apr.field_id")}>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            type="tel"
            placeholder="+998 90 123 45 67"
            className="w-full rounded-xl bg-surface-1 px-4 py-3 text-base font-medium ring-1 ring-line-strong focus:outline-none focus:ring-2 focus:ring-tg-button"
          />
        </Field>
        <Field label={t("apr.field_name")}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Aziz"
            className="w-full rounded-xl bg-surface-1 px-4 py-3 text-base font-medium ring-1 ring-line-strong focus:outline-none focus:ring-2 focus:ring-tg-button"
          />
        </Field>
        {error ? (
          <div className="rounded-xl bg-tg-destructive/10 px-3 py-2 text-sm text-tg-destructive ring-1 ring-tg-destructive/30">
            {error}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

function BlockOutSheet({
  target,
  onClose,
  onSaved,
}: {
  target: Apprentice | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [startTime, setStartTime] = useState("12:00");
  const [endTime, setEndTime] = useState("17:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!target) return;
    setError(null);
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    if (!Number.isFinite(sh) || !Number.isFinite(eh)) {
      setError(t("apr.end_after_start"));
      return;
    }
    const now = new Date();
    const start = new Date(now);
    start.setHours(sh, sm ?? 0, 0, 0);
    const end = new Date(now);
    end.setHours(eh, em ?? 0, 0, 0);
    if (end <= start) {
      setError(t("apr.end_after_start"));
      return;
    }
    setBusy(true);
    try {
      await api.insertBlock({
        barberId: target.id,
        startAt: start.toISOString(),
        durationMin: Math.round((end.getTime() - start.getTime()) / 60_000),
        type: "MANUAL",
        note: "Admin block-out",
        mode: "shift",
      });
      haptic("success");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={!!target}
      onClose={onClose}
      title={target ? t("apr.block_title", { name: target.displayName }) : ""}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button fullWidth onClick={submit} disabled={busy}>
            {busy ? t("common.saving") : t("apr.save_block")}
          </Button>
        </div>
      }
    >
      <p className="mb-4 text-sm text-tg-hint">
        {target ? t("apr.block_hint", { name: target.displayName }) : ""}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("apr.from")}>
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="w-full rounded-xl bg-surface-1 px-3 py-3 text-base font-semibold ring-1 ring-line-strong focus:outline-none focus:ring-2 focus:ring-tg-button"
          />
        </Field>
        <Field label={t("apr.to")}>
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="w-full rounded-xl bg-surface-1 px-3 py-3 text-base font-semibold ring-1 ring-line-strong focus:outline-none focus:ring-2 focus:ring-tg-button"
          />
        </Field>
      </div>
      {error ? (
        <div className="mt-3 rounded-xl bg-tg-destructive/10 px-3 py-2 text-sm text-tg-destructive ring-1 ring-tg-destructive/30">
          {error}
        </div>
      ) : null}
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
