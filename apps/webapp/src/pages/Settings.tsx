import { useNavigate } from "react-router-dom";
import type { MeResponse } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { ListItem } from "../components/ui/Card";
import { useT } from "../state/Lang";

export function Settings({ me }: { me: MeResponse }) {
  const nav = useNavigate();
  const t = useT();

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t("set.title")} subtitle={me.shop.name} onBack={() => nav("/dashboard")} />

      <div className="space-y-2 px-5 pb-6">
        <ListItem
          leading={<IconBadge emoji="🏪" />}
          title={t("set.shop_info")}
          subtitle={t("set.shop_info_sub")}
          trailing={<Chevron />}
          onClick={() => nav("/settings/shop-info")}
        />
        <ListItem
          leading={<IconBadge emoji="🌴" />}
          title={t("set.vacations")}
          subtitle={t("set.vacations_sub")}
          trailing={<Chevron />}
          onClick={() => nav("/settings/vacations")}
        />
        {me.shop.hasApprenticeFeature ? (
          <ListItem
            leading={<IconBadge emoji="👥" />}
            title={t("set.apprentices")}
            subtitle={t("set.apprentices_sub")}
            trailing={<Chevron />}
            onClick={() => nav("/settings/apprentices")}
          />
        ) : null}
        <ListItem
          leading={<IconBadge emoji="✂️" />}
          title={t("set.services")}
          subtitle={t("set.services_sub")}
          trailing={<Chevron />}
          onClick={() => nav("/settings/services")}
        />
        <ListItem
          leading={<IconBadge emoji="📢" />}
          title={t("set.announcements")}
          subtitle={t("set.announcements_sub")}
          trailing={<Chevron />}
          onClick={() => nav("/settings/announcements")}
        />
        <ListItem
          leading={<IconBadge emoji="📒" />}
          title={t("set.clients")}
          subtitle={t("set.clients_sub")}
          trailing={<Chevron />}
          onClick={() => nav("/settings/clients")}
        />
        <ListItem
          leading={<IconBadge emoji="💰" />}
          title={t("set.finances")}
          subtitle={t("set.finances_sub")}
          trailing={<Chevron />}
          onClick={() => nav("/settings/finances")}
        />
      </div>
    </div>
  );
}

function IconBadge({ emoji }: { emoji: string }) {
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-tg-button/15 text-lg ring-1 ring-tg-button/30">
      {emoji}
    </div>
  );
}

function Chevron() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-tg-hint">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
