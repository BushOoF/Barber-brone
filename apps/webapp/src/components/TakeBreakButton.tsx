import { useEffect, useState } from "react";
import { api, type InsertBlockResponse } from "../lib/api";
import { Button } from "./ui/Button";
import { Sheet } from "./ui/Sheet";
import { haptic } from "../lib/telegram";
import { formatTime } from "../lib/format";
import { useT } from "../state/Lang";

interface Props {
  barberId?: string;
  onApplied: () => void;
}

const PRESETS = [15, 30, 45, 60, 90, 120, 180];

type Phase = "configure" | "previewed";

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function nowHHMM(roundUpMin = 5): string {
  const d = new Date();
  // Round UP to the next 5 min so "From = Now" feels natural and avoids past-time edge cases.
  const ms = roundUpMin * 60_000;
  const rounded = new Date(Math.ceil(d.getTime() / ms) * ms);
  return `${pad(rounded.getHours())}:${pad(rounded.getMinutes())}`;
}

function addMinHHMM(hhmm: string, min: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m + min, 0, 0);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function diffMin(fromHHMM: string, toHHMM: string): number {
  const [fh, fm] = fromHHMM.split(":").map(Number);
  const [th, tm] = toHHMM.split(":").map(Number);
  return th * 60 + tm - (fh * 60 + fm);
}

function todayWithTime(hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

export function TakeBreakButton({ barberId, onApplied }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"BREAK" | "WALK_IN">("BREAK");
  const [fromTime, setFromTime] = useState<string>(() => nowHHMM(5));
  const [toTime, setToTime] = useState<string>(() => addMinHHMM(nowHHMM(5), 30));
  const [phase, setPhase] = useState<Phase>("configure");
  const [plan, setPlan] = useState<InsertBlockResponse["plan"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset to fresh defaults each time the sheet opens.
  useEffect(() => {
    if (open) {
      const now = nowHHMM(5);
      setFromTime(now);
      setToTime(addMinHHMM(now, 30));
      setPhase("configure");
      setPlan(null);
      setError(null);
    }
  }, [open]);

  // Whenever From changes after a preview, the plan is stale.
  useEffect(() => {
    if (phase === "previewed") {
      setPhase("configure");
      setPlan(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromTime, toTime, type]);

  const duration = diffMin(fromTime, toTime);
  const valid = duration >= 5;

  const close = () => setOpen(false);

  const setPreset = (m: number) => {
    setToTime(addMinHHMM(fromTime, m));
  };

  const setFromNow = () => {
    const now = nowHHMM(5);
    setFromTime(now);
    setToTime(addMinHHMM(now, Math.max(15, duration)));
  };

  const dryRun = async () => {
    if (!valid) {
      setError(t("tab.invalid_range"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.insertBlock({
        barberId,
        startAt: todayWithTime(fromTime).toISOString(),
        durationMin: duration,
        type,
        mode: "dry_run",
      });
      setPlan(result.plan ?? null);
      setPhase("previewed");
      haptic("light");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const applyMode = async (mode: "shift" | "transfer") => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await api.insertBlock({
        barberId,
        startAt: todayWithTime(fromTime).toISOString(),
        durationMin: duration,
        type,
        mode,
      });
      haptic("success");
      onApplied();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const overlappingCount = plan?.overlapping.length ?? 0;
  const canTransferAll = plan ? plan.transferable.length > 0 && plan.transferable.every((tx) => tx.canTransfer) : false;
  const transferTarget = plan?.suggestedTransferTo;

  return (
    <>
      <Button
        variant="dark"
        size="lg"
        fullWidth
        onClick={() => {
          haptic("medium");
          setOpen(true);
        }}
        hapticOnPress={false}
      >
        {t("tab.button")}
      </Button>

      <Sheet
        open={open}
        onClose={close}
        title={t("tab.title")}
        footer={
          <FooterButtons
            phase={phase}
            plan={plan}
            busy={busy}
            valid={valid}
            canTransferAll={canTransferAll}
            overlappingCount={overlappingCount}
            transferTargetName={transferTarget?.displayName}
            onCancel={close}
            onPreview={dryRun}
            onShift={() => applyMode("shift")}
            onTransfer={() => applyMode("transfer")}
          />
        }
      >
        <p className="mb-4 text-sm text-tg-hint">{t("tab.intro")}</p>

        <div className="mb-4 flex gap-1.5 rounded-2xl bg-surface-1 p-1 ring-1 ring-line-soft">
          {(["BREAK", "WALK_IN"] as const).map((tp) => {
            const active = type === tp;
            return (
              <button
                key={tp}
                type="button"
                onClick={() => setType(tp)}
                className={
                  "flex-1 rounded-xl px-3 py-2 text-sm font-bold transition " +
                  (active ? "bg-tg-button text-tg-buttonText shadow-soft" : "text-tg-hint")
                }
              >
                {tp === "BREAK" ? t("tab.type_break") : t("tab.type_walkin")}
              </button>
            );
          })}
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <TimeField label={t("tab.from")} value={fromTime} onChange={setFromTime} />
          <TimeField label={t("tab.to")} value={toTime} onChange={setToTime} />
        </div>

        <div className="mb-3 flex items-center justify-between">
          <button
            type="button"
            onClick={setFromNow}
            className="rounded-full bg-surface-1 px-3 py-1 text-xs font-bold ring-1 ring-line-strong active:scale-95"
          >
            ⏱ {t("tab.now")}
          </button>
          <div className="text-xs font-semibold tabular-nums text-tg-hint">
            {valid ? `${t("tab.set_duration")} ${duration} ${t("common.min")}` : t("tab.invalid_range")}
          </div>
        </div>

        <div className="mb-3 text-[11px] font-bold uppercase tracking-wider text-tg-hint">{t("tab.duration")}</div>
        <div className="mb-2 flex flex-wrap gap-2">
          {PRESETS.map((m) => {
            const active = duration === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setPreset(m)}
                className={
                  "rounded-full px-4 py-2 text-sm font-bold transition active:scale-95 " +
                  (active
                    ? "bg-tg-text text-tg-bg ring-1 ring-tg-text shadow-soft"
                    : "bg-surface-1 text-tg-text ring-1 ring-line-strong")
                }
              >
                {m} {t("common.min")}
              </button>
            );
          })}
        </div>

        {plan ? <ImpactPanel plan={plan} canTransferAll={canTransferAll} /> : null}

        {error ? (
          <div className="mt-4 rounded-xl bg-tg-destructive/10 px-3 py-2 text-sm text-tg-destructive ring-1 ring-tg-destructive/30">
            {error}
          </div>
        ) : null}
      </Sheet>
    </>
  );
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-tg-hint">{label}</span>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl bg-surface-1 px-3 py-3 text-xl font-extrabold tabular-nums ring-1 ring-line-strong focus:outline-none focus:ring-2 focus:ring-tg-button"
      />
    </label>
  );
}

function ImpactPanel({ plan, canTransferAll }: { plan: NonNullable<InsertBlockResponse["plan"]>; canTransferAll: boolean }) {
  const t = useT();
  const overlapping = plan.overlapping;
  if (overlapping.length === 0 && plan.moves.length === 0) {
    return (
      <div className="mt-4 rounded-2xl bg-emerald-500/10 px-4 py-3 ring-1 ring-emerald-500/30">
        <div className="text-sm font-bold text-emerald-700">{t("tab.no_conflicts")}</div>
        <div className="text-xs text-emerald-700/80">{t("tab.nobody_booked")}</div>
      </div>
    );
  }
  return (
    <div className="mt-4 space-y-3">
      {overlapping.length > 0 ? (
        <div className="rounded-2xl bg-amber-500/10 p-4 ring-1 ring-amber-500/30">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-amber-700">{t("tab.affected", { n: overlapping.length })}</div>
            {plan.suggestedTransferTo ? (
              <div
                className={
                  "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider " +
                  (canTransferAll
                    ? "bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/40"
                    : "bg-tg-hint/20 text-tg-hint")
                }
              >
                {canTransferAll ? t("tab.apprentice_free") : t("tab.apprentice_busy")}
              </div>
            ) : null}
          </div>
          <ul className="mt-2 space-y-1 text-xs text-amber-700">
            {overlapping.map((c) => (
              <li key={c.bookingId}>
                · {formatTime(c.startAt)} — {c.customer}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {plan.moves.length > 0 ? (
        <div className="rounded-2xl bg-surface-1 p-3 ring-1 ring-line-soft">
          <div className="text-[11px] font-bold uppercase tracking-wider text-tg-hint">{t("tab.if_shift")}</div>
          <ul className="mt-1 space-y-0.5 text-xs text-tg-text">
            {plan.moves.map((m) => (
              <li key={m.bookingId} className="flex justify-between">
                <span>{formatTime(m.oldStart)}</span>
                <span className="font-bold">→ {formatTime(m.newStart)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {plan.unplaceable.length > 0 ? (
        <div className="rounded-2xl bg-tg-destructive/10 px-3 py-2 text-xs text-tg-destructive ring-1 ring-tg-destructive/30">
          {t("tab.unplaceable", { n: plan.unplaceable.length })}
        </div>
      ) : null}
    </div>
  );
}

function FooterButtons({
  phase,
  plan,
  busy,
  valid,
  canTransferAll,
  overlappingCount,
  transferTargetName,
  onCancel,
  onPreview,
  onShift,
  onTransfer,
}: {
  phase: Phase;
  plan: InsertBlockResponse["plan"] | null;
  busy: boolean;
  valid: boolean;
  canTransferAll: boolean;
  overlappingCount: number;
  transferTargetName?: string;
  onCancel: () => void;
  onPreview: () => void;
  onShift: () => void;
  onTransfer: () => void;
}) {
  const t = useT();
  if (phase === "configure" || !plan) {
    return (
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button fullWidth variant="dark" onClick={onPreview} disabled={busy || !valid}>
          {busy ? t("common.checking") : t("tab.preview")}
        </Button>
      </div>
    );
  }
  if (overlappingCount === 0) {
    return (
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button fullWidth onClick={onShift} disabled={busy}>
          {busy ? t("common.applying") : t("tab.confirm_block")}
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Button fullWidth size="lg" onClick={onShift} disabled={busy}>
        {t("tab.shift_btn", { n: overlappingCount })}
      </Button>
      {transferTargetName ? (
        <Button
          fullWidth
          size="lg"
          variant={canTransferAll ? "secondary" : "ghost"}
          onClick={onTransfer}
          disabled={busy || !canTransferAll}
        >
          {canTransferAll
            ? t("tab.transfer_btn", { name: transferTargetName })
            : t("tab.transfer_disabled", { name: transferTargetName })}
        </Button>
      ) : null}
      <button type="button" onClick={onCancel} className="w-full py-2 text-sm font-semibold text-tg-hint">
        {t("common.cancel")}
      </button>
    </div>
  );
}
