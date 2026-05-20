import type { Booking, DayBookingsResponse } from "../lib/api";
import { ClientCard } from "./ClientCard";
import { formatTime } from "../lib/format";
import { useT } from "../state/Lang";

interface Props {
  data: DayBookingsResponse;
  currency: string;
  pxPerMin?: number;
  canTransfer: boolean;
  onDiscard: (b: Booking) => void;
  onTransfer: (b: Booking) => void;
  onShiftRequest: (b: Booking) => void;
}

interface Row {
  kind: "gap" | "block" | "booking";
  startAt: Date;
  endAt: Date;
  booking?: Booking;
  block?: DayBookingsResponse["blocks"][number];
}

export function Timeline({ data, currency, pxPerMin = 1.8, canTransfer, onDiscard, onTransfer, onShiftRequest }: Props) {
  const t = useT();
  const items: Row[] = [];
  const all = [
    ...data.bookings
      .filter((b) => b.status === "SCHEDULED")
      .map<Row>((b) => ({ kind: "booking" as const, startAt: new Date(b.startAt), endAt: new Date(b.endAt), booking: b })),
    ...data.blocks.map<Row>((b) => ({ kind: "block" as const, startAt: new Date(b.startAt), endAt: new Date(b.endAt), block: b })),
  ].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  for (let i = 0; i < all.length; i++) {
    const cur = all[i];
    const prev = i > 0 ? all[i - 1] : null;
    if (prev) {
      const gapMin = Math.round((cur.startAt.getTime() - prev.endAt.getTime()) / 60_000);
      if (gapMin > 0) {
        items.push({ kind: "gap", startAt: prev.endAt, endAt: cur.startAt });
      }
    }
    items.push(cur);
  }

  if (all.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-3xl bg-surface-1 p-12 text-center ring-1 ring-line-soft">
        <div>
          <div className="text-5xl">🪑</div>
          <p className="mt-3 text-sm font-semibold">{t("dash.no_bookings_title")}</p>
          <p className="mt-1 text-xs text-tg-hint">{t("dash.no_bookings_sub")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((row, idx) => {
        const minutes = Math.max(1, Math.round((row.endAt.getTime() - row.startAt.getTime()) / 60_000));
        const height = clampHeight(minutes, pxPerMin, row.kind);
        const startLabel = formatTime(row.startAt.toISOString());
        const endLabel = formatTime(row.endAt.toISOString());

        if (row.kind === "gap") {
          return (
            <div key={`gap-${idx}`} className="grid grid-cols-[56px_1fr] gap-2 items-stretch" style={{ height }}>
              <TimeGutter primary={startLabel} secondary={`→ ${endLabel}`} muted />
              <div className="flex items-center justify-center rounded-xl border border-dashed border-line-strong text-[11px] font-bold uppercase tracking-wider text-tg-hint">
                {minutes} {t("dash.min_free")}
              </div>
            </div>
          );
        }
        if (row.kind === "block") {
          const blockLabel =
            row.block!.type === "BREAK" ? t("block.break") : row.block!.type === "WALK_IN" ? t("block.walkin") : t("block.blocked");
          const emoji = row.block!.type === "BREAK" ? "☕" : row.block!.type === "WALK_IN" ? "🚶" : "🚫";
          return (
            <div key={row.block!.id} className="grid grid-cols-[56px_1fr] gap-2 items-stretch" style={{ height }}>
              <TimeGutter primary={startLabel} secondary={`→ ${endLabel}`} />
              <div className="flex items-center justify-between rounded-2xl bg-tg-text/8 px-4 ring-1 ring-line-strong">
                <div>
                  <div className="text-sm font-bold">{blockLabel}</div>
                  <div className="text-[11px] text-tg-hint">{t("block.minutes", { n: minutes })}</div>
                </div>
                <div className="text-2xl opacity-50">{emoji}</div>
              </div>
            </div>
          );
        }
        return (
          <div key={row.booking!.id} className="grid grid-cols-[56px_1fr] gap-2 items-stretch" style={{ height }}>
            <TimeGutter primary={startLabel} secondary={`→ ${endLabel}`} accent />
            <ClientCard
              booking={row.booking!}
              currency={currency}
              canTransfer={canTransfer}
              onDiscard={onDiscard}
              onTransfer={onTransfer}
              onShiftRequest={onShiftRequest}
            />
          </div>
        );
      })}
    </div>
  );
}

function clampHeight(minutes: number, pxPerMin: number, kind: Row["kind"]): number {
  const minByKind = kind === "booking" ? 92 : kind === "block" ? 56 : 28;
  return Math.max(minByKind, Math.round(minutes * pxPerMin));
}

function TimeGutter({ primary, secondary, muted, accent }: { primary: string; secondary?: string; muted?: boolean; accent?: boolean }) {
  return (
    <div
      className={[
        "flex flex-col items-end justify-center rounded-xl pr-1 pl-1 text-right",
        accent ? "bg-tg-button/8 ring-1 ring-tg-button/20" : "",
        muted ? "opacity-60" : "",
      ].join(" ")}
    >
      <div className="text-base font-extrabold tabular-nums leading-tight">{primary}</div>
      {secondary ? <div className="text-[10px] text-tg-hint tabular-nums">{secondary}</div> : null}
    </div>
  );
}
