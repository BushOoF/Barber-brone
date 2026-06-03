import { motion, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import { useState } from "react";
import { haptic } from "../lib/telegram";
import { formatMoney, formatDuration } from "../lib/format";
import type { Booking } from "../lib/api";
import { useT, useLang } from "../state/Lang";
import { localizedServiceName } from "../lib/i18n";

interface Props {
  booking: Booking;
  currency: string;
  canTransfer: boolean;
  onDiscard: (b: Booking) => void;
  onTransfer: (b: Booking) => void;
  onShiftRequest: (b: Booking) => void;
}

const FULL_REVEAL_PX = 176; // right drawer: discard + apprentice (or just discard).
const SHIFT_REVEAL_PX = 88; // left drawer: single "Shift time" button.
const SNAP_RIGHT_PX = FULL_REVEAL_PX / 2.5; // threshold to snap-open the right drawer.
const SNAP_LEFT_PX = SHIFT_REVEAL_PX / 2; // threshold to snap-open the left drawer (shift).

export function ClientCard({ booking, currency, canTransfer, onDiscard, onTransfer, onShiftRequest }: Props) {
  const t = useT();
  const lang = useLang();
  const x = useMotionValue(0);
  const [revealed, setRevealed] = useState<"none" | "left" | "right">("none");

  const drawerRightWidth = canTransfer ? FULL_REVEAL_PX : 88;

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const dx = info.offset.x;
    const vx = info.velocity.x;
    // Snap-open right drawer (swipe LEFT)
    if (dx < -SNAP_RIGHT_PX || vx < -300) {
      x.set(-drawerRightWidth);
      setRevealed("right");
      haptic("medium");
      return;
    }
    // Snap-open left drawer (swipe RIGHT)
    if (dx > SNAP_LEFT_PX || vx > 300) {
      x.set(SHIFT_REVEAL_PX);
      setRevealed("left");
      haptic("medium");
      return;
    }
    // Otherwise snap closed.
    x.set(0);
    setRevealed("none");
  };

  const close = () => {
    x.set(0);
    setRevealed("none");
  };

  const opacityRight = useTransform(x, [-drawerRightWidth, 0], [1, 0.25]);
  const opacityLeft = useTransform(x, [0, SHIFT_REVEAL_PX], [0.25, 1]);

  const customerName = booking.user?.firstName || booking.user?.username || (booking.user?.phone ?? "Customer");
  const extras = booking.services.filter((s) => s !== "haircut_adult" && s !== "haircut_child");

  return (
    <div className="relative h-full overflow-hidden rounded-2xl">
      {/* Left drawer: Shift time */}
      <motion.div
        style={{ opacity: opacityLeft }}
        className="pointer-events-none absolute inset-y-0 left-0 flex w-[88px] items-stretch overflow-hidden rounded-2xl"
        aria-hidden={revealed !== "left"}
      >
        <ActionButton
          label={t("card.shift")}
          icon="🕒"
          className="bg-warning text-white pointer-events-auto"
          onClick={() => {
            onShiftRequest(booking);
            close();
          }}
          width={88}
        />
      </motion.div>

      {/* Right drawer: Discard (+ optional Apprentice) */}
      <motion.div
        style={{ opacity: opacityRight }}
        className="pointer-events-none absolute inset-y-0 right-0 flex w-full items-stretch justify-end gap-0 overflow-hidden rounded-2xl"
        aria-hidden={revealed !== "right"}
      >
        {canTransfer ? (
          <ActionButton
            label={t("card.apprentice")}
            icon="→"
            className="bg-tg-button text-tg-buttonText pointer-events-auto"
            onClick={() => {
              onTransfer(booking);
              close();
            }}
            width={88}
          />
        ) : null}
        <ActionButton
          label={t("card.discard")}
          icon="✕"
          className="bg-tg-destructive text-white pointer-events-auto"
          onClick={() => {
            onDiscard(booking);
            close();
          }}
          width={88}
        />
      </motion.div>

      {/* Foreground card */}
      <motion.div
        drag="x"
        dragConstraints={{ left: -drawerRightWidth, right: SHIFT_REVEAL_PX }}
        dragElastic={0.06}
        dragMomentum={false}
        style={{ x }}
        onDragEnd={onDragEnd}
        onClick={() => revealed !== "none" && close()}
        transition={{ type: "spring", damping: 30, stiffness: 320 }}
        className="absolute inset-0 cursor-grab rounded-2xl bg-surface-1 px-4 py-3 ring-1 ring-line-strong shadow-soft active:cursor-grabbing"
      >
        <div className="flex h-full flex-col justify-between gap-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-base font-bold leading-tight">{customerName}</div>
              {booking.user?.phone ? (
                <a
                  href={`tel:${booking.user.phone}`}
                  className="mt-0.5 inline-block text-xs font-semibold text-tg-link"
                  onClick={(e) => e.stopPropagation()}
                >
                  {booking.user.phone}
                </a>
              ) : null}
            </div>
            <div className="ml-2 shrink-0 text-right">
              <div className="text-sm font-bold tabular-nums">{formatMoney(booking.totalPriceMinor, currency)}</div>
              <div className="text-[11px] text-tg-hint">{formatDuration(booking.durationMin)}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {booking.adults > 0 ? (
              <Chip>
                {booking.adults} {booking.adults === 1 ? t("common.adult") : t("common.adults_plural")}
              </Chip>
            ) : null}
            {booking.children > 0 ? (
              <Chip>
                {booking.children} {booking.children === 1 ? t("common.child") : t("common.children_plural")}
              </Chip>
            ) : null}
            {extras.map((k) => (
              <Chip key={k}>{localizedServiceName(lang, k, k)}</Chip>
            ))}
            <span className="ml-auto flex items-center gap-2 eyebrow text-tg-hint">
              <span>{t("card.swipe_right_hint")}</span>
              <span>·</span>
              <span>{t("dash.swipe_hint")}</span>
            </span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function ActionButton({
  label,
  icon,
  className,
  width,
  onClick,
}: {
  label: string;
  icon: string;
  className: string;
  width: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ width }}
      className={"flex h-full flex-col items-center justify-center gap-1 transition active:brightness-90 " + className}
    >
      <span className="text-xl font-bold">{icon}</span>
      <span className="eyebrow">{label}</span>
    </button>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-tg-bg px-2 py-0.5 text-[10px] font-semibold text-tg-hint ring-1 ring-line-strong">
      {children}
    </span>
  );
}
