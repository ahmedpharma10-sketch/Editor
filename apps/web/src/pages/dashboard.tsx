/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { Match, Show, Switch } from "solid-js";

import { DashboardAccountView } from "@/components/dashboard/account-view";
import { DashboardAiCreditsView } from "@/components/dashboard/ai-credits-view";
import { DashboardBillingView } from "@/components/dashboard/billing-view";
import { DashboardGetDesktopApp } from "@/components/dashboard/get-desktop-app";
import { DashboardHelpView } from "@/components/dashboard/help-view";
import { DashboardProjectsView } from "@/components/dashboard/projects-view";
import { DashboardSettingsView } from "@/components/dashboard/settings-view";
import { DashboardSidebarHeader, DashboardSidebarNav, DashboardSidebarUser, DashboardSidebarItem } from "@/components/dashboard/sidebar";
import { Separator } from "@/components/ui/separator";

import type { DashboardView } from "@/components/dashboard/types";

const DASHBOARD_VIEWS: readonly DashboardView[] = [
  "projects",
  "templates",
  "ai-credits",
  "billing",
  "account",
  "settings",
  "preferences",
  "help",
];

function parseView(value: string | string[] | undefined): DashboardView {
  const raw = Array.isArray(value) ? value[0] : value;
  return DASHBOARD_VIEWS.find((v) => v === raw) ?? "projects";
}

export function DashboardPage() {
  const [params, setParams] = useSearchParams();

  const view = (): DashboardView => parseView(params.dashboard);
  const setView = (next: DashboardView) => setParams({ dashboard: next }, { replace: true });

  return (
    <div class="flex h-screen w-full min-h-0 flex-row overflow-hidden bg-background">
      <Show when={!!window.desktop}>
        <div class="fixed top-0 left-0 right-0 h-10 z-20" style="-webkit-app-region: drag;" />
      </Show>
      <aside class="flex min-h-0 w-56 shrink-0 flex-col bg-card">
        <DashboardSidebarHeader />
        <DashboardSidebarNav>
          <DashboardSidebarItem active={view() === "projects"} onClick={() => setView("projects")} icon="diffusion-project-file" label="Projects" />
          <DashboardSidebarItem active={view() === "ai-credits"} onClick={() => setView("ai-credits")} icon="ai-generate" label="AI credits" class="mt-auto" />
          <DashboardSidebarItem active={view() === "billing"} onClick={() => setView("billing")} icon="billing" label="Billing" />
          <DashboardSidebarItem active={view() === "settings"} onClick={() => setView("settings")} icon="settings" label="Settings" />
          <DashboardSidebarItem active={view() === "help"} onClick={() => setView("help")} icon="help" label="Help" />
        </DashboardSidebarNav>
        <DashboardSidebarUser active={view() === "account"} onClick={() => setView("account")} />
      </aside>

      <Separator orientation="vertical" class="bg-border-strong" />

      <section class="flex min-h-0 flex-1 flex-col bg-canvas">
        <Switch>
          <Match when={view() === "projects"}>
            <DashboardProjectsView />
          </Match>
          <Match when={view() === "ai-credits"}>
            <DashboardAiCreditsView />
          </Match>
          <Match when={view() === "billing"}>
            <DashboardBillingView />
          </Match>
          <Match when={view() === "account"}>
            <DashboardAccountView />
          </Match>
          <Match when={view() === "settings"}>
            <DashboardSettingsView />
          </Match>
          <Match when={view() === "help"}>
            <DashboardHelpView />
          </Match>
        </Switch>
        <DashboardGetDesktopApp />
      </section>
    </div>
  );
}
