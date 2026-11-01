import { initI18n } from "@statly/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router";
import { bridge } from "./bridge/index.ts";
import { DashboardPage } from "./features/dashboard/DashboardPage.tsx";
import { LibraryPage } from "./features/library/LibraryPage.tsx";
import { SettingsPage } from "./features/settings/SettingsPage.tsx";
import { EditorPage } from "./features/widgets/editor/EditorPage.tsx";
import "./index.css";
import { AppearanceProvider } from "./lib/appearance.tsx";
import { ErrorPage } from "./pages/ErrorPage.tsx";
import { Shell } from "./shell/Shell.tsx";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

const router = createHashRouter([
  {
    element: <Shell />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "library", element: <LibraryPage /> },
      { path: "library/widgets/:id", element: <EditorPage /> },
      { path: "settings/:section?", element: <SettingsPage /> },
    ],
  },
]);

async function start() {
  const [info, settings] = await Promise.all([
    bridge.call("system.info", {}),
    bridge.call("settings.get", {}),
  ]);
  await initI18n(settings.language === "auto" ? info.language : settings.language);

  const root = document.getElementById("root");
  if (!root) {
    throw new Error("The page has no root element.");
  }
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AppearanceProvider
          initial={settings}
          ankiLanguage={info.language}
          ankiNightMode={info.nightMode}
        >
          <RouterProvider router={router} />
        </AppearanceProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

void start();
