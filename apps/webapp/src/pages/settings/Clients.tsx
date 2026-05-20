import { useState } from "react";
import { api } from "../../lib/api";
import { useApi } from "../../hooks/useApi";
import { PageHeader } from "../../components/PageHeader";
import { useT } from "../../state/Lang";

export function ClientsPage() {
  const t = useT();
  const [q, setQ] = useState("");
  const list = useApi(() => api.adminListUsers(q || undefined), [q]);
  const users = list.data?.users ?? [];

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t("cli.title")}
        subtitle={`${users.length} ${users.length === 1 ? t("cli.record") : t("cli.records")}`}
      />

      <div className="px-5 pb-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("cli.search_placeholder")}
          className="w-full rounded-2xl bg-surface-1 px-4 py-3 text-base ring-1 ring-line-strong focus:outline-none focus:ring-2 focus:ring-tg-button"
        />
      </div>

      <div className="flex-1 space-y-1.5 overflow-y-auto px-5 pb-6">
        {list.status === "loading" ? (
          <>
            <div className="h-14 rounded-xl shimmer" />
            <div className="h-14 rounded-xl shimmer" />
            <div className="h-14 rounded-xl shimmer" />
          </>
        ) : users.length === 0 ? (
          <div className="mt-8 rounded-2xl bg-surface-1 p-8 text-center ring-1 ring-line-soft">
            <div className="text-3xl">📭</div>
            <p className="mt-2 text-sm text-tg-hint">{t("cli.no_match")}</p>
          </div>
        ) : (
          users.map((u) => {
            const fullName = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || t("landing.barber");
            return (
              <div key={u.id} className="rounded-xl bg-surface-1 px-4 py-3 ring-1 ring-line-soft">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold">{fullName}</div>
                    <div className="mt-0.5 text-xs text-tg-hint">
                      {u.username ? `@${u.username}` : "—"}
                      {u.phone ? ` · ${u.phone}` : ""}
                      {u.language ? ` · ${u.language}` : ""}
                    </div>
                  </div>
                  <span
                    className={
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider " +
                      (u.role === "ADMIN"
                        ? "bg-tg-button/15 text-tg-button"
                        : u.role === "APPRENTICE"
                        ? "bg-emerald-500/15 text-emerald-600"
                        : "bg-tg-hint/15 text-tg-hint")
                    }
                  >
                    {u.role.toLowerCase()}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
