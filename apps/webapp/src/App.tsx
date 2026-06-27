import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useApi } from "./hooks/useApi";
import { api } from "./lib/api";
import { Landing } from "./pages/Landing";
import { Configure } from "./pages/Configure";
import { Confirmation } from "./pages/Confirmation";
import { MyBookings } from "./pages/MyBookings";
import { Dashboard } from "./pages/Dashboard";
import { Settings } from "./pages/Settings";
import { ApprenticesPage } from "./pages/settings/Apprentices";
import { ServicesPage } from "./pages/settings/Services";
import { ClientsPage } from "./pages/settings/Clients";
import { FinancesPage } from "./pages/settings/Finances";
import { ShopInfoPage } from "./pages/settings/ShopInfo";
import { AnnouncementsPage } from "./pages/settings/Announcements";
import { VacationDaysPage } from "./pages/settings/VacationDays";
import { LangProvider } from "./state/Lang";
import { DEFAULT_LANG, translate, type Lang } from "./lib/i18n";

export function App() {
  const { data, status, error } = useApi(() => api.me(), []);

  if (status === "loading" || status === "idle") {
    return <LoadingScreen />;
  }
  if (status === "error" || !data) {
    return <ErrorScreen error={error} lang={DEFAULT_LANG} />;
  }

  const lang = (data.user.language as Lang) ?? DEFAULT_LANG;
  const isStaff = data.user.role !== "CUSTOMER" && data.barber !== null;
  const isAdmin = data.user.role === "ADMIN";
  const hasPhone = !!data.user.phone;

  return (
    <LangProvider lang={lang}>
      <Shell>
      <Routes>
        <Route
          path="/"
          element={
            !hasPhone ? <NeedPhoneScreen lang={lang} /> : isStaff ? <Navigate to="/dashboard" replace /> : <Landing me={data} />
          }
        />
        <Route path="/configure" element={hasPhone ? <Configure me={data} /> : <Navigate to="/" replace />} />
        <Route path="/confirmation/:id" element={<Confirmation me={data} />} />
        <Route path="/my-bookings" element={hasPhone ? <MyBookings me={data} /> : <Navigate to="/" replace />} />
        <Route path="/dashboard" element={isStaff ? <Dashboard me={data} /> : <Navigate to="/" replace />} />

        {/* Admin-only Settings tree */}
        <Route path="/settings" element={isAdmin ? <Settings me={data} /> : <Navigate to="/dashboard" replace />} />
        <Route
          path="/settings/shop-info"
          element={isAdmin ? <ShopInfoPage me={data} /> : <Navigate to="/dashboard" replace />}
        />
        <Route
          path="/settings/vacations"
          element={isAdmin ? <VacationDaysPage /> : <Navigate to="/dashboard" replace />}
        />
        <Route
          path="/settings/apprentices"
          element={isAdmin && data.shop.hasApprenticeFeature ? <ApprenticesPage me={data} /> : <Navigate to="/settings" replace />}
        />
        <Route
          path="/settings/services"
          element={isAdmin ? <ServicesPage me={data} /> : <Navigate to="/dashboard" replace />}
        />
        <Route
          path="/settings/announcements"
          element={isAdmin ? <AnnouncementsPage /> : <Navigate to="/dashboard" replace />}
        />
        <Route path="/settings/clients" element={isAdmin ? <ClientsPage /> : <Navigate to="/dashboard" replace />} />
        <Route
          path="/settings/finances"
          element={isAdmin ? <FinancesPage me={data} /> : <Navigate to="/dashboard" replace />}
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Shell>
    </LangProvider>
  );
}

/**
 * Responsive frame. On phones the app fills the screen (Telegram Mini App look).
 * On wider screens (PC) it becomes a centered card on a neutral backdrop — wider
 * for the admin/dashboard/settings screens that show tables and charts, narrower
 * for the customer booking flow which reads best as a single column.
 */
function Shell({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const wide = pathname.startsWith("/dashboard") || pathname.startsWith("/settings");
  return (
    <div className="flex min-h-[100dvh] justify-center bg-tg-bg md:bg-[color-mix(in_srgb,var(--tg-text)_7%,var(--tg-bg))] md:p-6">
      <div
        className={
          "relative flex h-[100dvh] w-full flex-col overflow-hidden bg-tg-bg md:h-[calc(100dvh-3rem)] md:rounded-3xl md:shadow-soft md:ring-1 md:ring-line-soft " +
          (wide ? "md:max-w-5xl" : "md:max-w-md")
        }
      >
        {children}
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-line-soft border-t-tg-button" />
        <div className="text-sm font-medium text-tg-hint">{translate(DEFAULT_LANG, "common.loading")}</div>
      </div>
    </div>
  );
}

function ErrorScreen({ error, lang }: { error: Error | null; lang: Lang }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="text-5xl">🛠️</div>
      <h1 className="text-xl font-bold">{translate(lang, "auth.load_failed_title")}</h1>
      <p className="max-w-xs text-sm text-tg-hint">{error?.message ?? "Unknown error"}</p>
      <p className="text-xs text-tg-hint">{translate(lang, "auth.load_failed_hint")}</p>
    </div>
  );
}

function NeedPhoneScreen({ lang }: { lang: Lang }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="text-6xl">📱</div>
      <h1 className="text-2xl font-bold tracking-tight">{translate(lang, "auth.phone_title")}</h1>
      <p className="max-w-xs text-sm text-tg-hint">{translate(lang, "auth.phone_hint")}</p>
      <p className="text-xs text-tg-hint">
        <span className="font-semibold text-tg-text">{translate(lang, "auth.share_phone_strong")}</span>
      </p>
    </div>
  );
}
