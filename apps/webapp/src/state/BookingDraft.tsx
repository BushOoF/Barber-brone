import { createContext, useContext, useState, type ReactNode } from "react";

export interface BookingDraft {
  barberId: string | null;
  /** ISO datetime of the chosen slot. */
  startAt: string | null;
  adults: number;
  children: number;
  optional: string[];
  remindersOn: boolean;
}

const DEFAULT: BookingDraft = {
  barberId: null,
  startAt: null,
  adults: 1,
  children: 0,
  optional: [],
  remindersOn: true,
};

const Ctx = createContext<{
  draft: BookingDraft;
  set: (patch: Partial<BookingDraft>) => void;
  reset: () => void;
} | null>(null);

export function BookingDraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<BookingDraft>(DEFAULT);
  return (
    <Ctx.Provider
      value={{
        draft,
        set: (patch) => setDraft((d) => ({ ...d, ...patch })),
        reset: () => setDraft(DEFAULT),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useBookingDraft() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useBookingDraft must be used within BookingDraftProvider");
  return ctx;
}
