/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, type JSX } from "solid-js";
import { Icon } from "@/components/ui/icon";
import { useAuth } from "@/context/auth";
import { useAvatar } from "@/hooks/use-avatar";
import { Separator } from "@/components/ui/separator";
import { cx } from "@/lib/cva";

type DashboardSidebarItemProps = {
  icon: string;
  label: string;
  active?: boolean;
  onClick?(): void;
  class?: string;
};

export function DashboardSidebarItem(props: DashboardSidebarItemProps) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class={cx("flex h-8 w-full items-center rounded-md px-0 hover:bg-accent focus-ring", props.class)}
      classList={{ "bg-accent": props.active }}
    >
      <span class="grid size-7 place-items-center overflow-clip">
        <Show
          when={props.active}
          fallback={<Icon name={props.icon} class="size-6 text-muted-foreground" />}
        >
          <Icon name={props.icon} class="size-6 text-foreground" />
        </Show>
      </span>
      <span
        class="min-w-0 flex-1 truncate text-left text-xs text-muted-foreground"
        classList={{ "text-foreground": props.active }}
      >
        {props.label}
      </span>
    </button>
  );
}

export function DashboardSidebarHeader() {
  const auth = useAuth();

  return (
    // Extra top padding on the macOS desktop build clears the traffic lights
    // (hiddenInset title bar), except in fullscreen where they are gone.
    <div class="flex flex-col items-start gap-3 p-4 [[data-platform=darwin]:not([data-fullscreen=true])_&]:pt-12">
      <Icon name="diffusion-logo-large" class="size-6 text-muted-foreground" />
      <div class="flex h-10 w-full flex-col items-start gap-1 text-muted-foreground">
        <p class="w-full text-base leading-5  font-450 text-muted-foreground">
          {auth.isPro() ? "Diffusion Studio Pro" : "Diffusion Studio"}
        </p>
        <p class="w-full overflow-hidden text-xxs whitespace-nowrap text-ellipsis text-muted-foreground">
          v{APP_VERSION}
        </p>
      </div>
    </div>
  );
}

type DashboardSidebarNavProps = {
  children: JSX.Element;
};

export function DashboardSidebarNav(props: DashboardSidebarNavProps) {
  return (
    <div class="flex min-h-0 flex-1 flex-col gap-2 px-4">
      <Separator />
      <div class="flex min-h-0 flex-1 flex-col gap-1">
        <div class="flex h-8 items-center px-1">
          <p class="text-xs font-450 text-muted-foreground">
            Get Started
          </p>
        </div>
        {props.children}
      </div>
      <Separator />
    </div>
  );
}

type DashboardSidebarUserProps = {
  active: boolean;
  onClick: () => void;
};

export function DashboardSidebarUser(props: DashboardSidebarUserProps) {
  const auth = useAuth();

  const displayName = () => {
    const user = auth.user();
    return user?.user_metadata?.full_name || user?.email || "User";
  };

  const planLabel = () => (auth.isPro() ? "Pro Plan" : "Free Plan");

  const initial = () => displayName().charAt(0).toUpperCase();
  const avatarUrl = useAvatar();

  return (
    <div class="p-2">
      <button
        type="button"
        onClick={props.onClick}
        class="flex w-full items-center gap-2 rounded-md p-2 text-left hover:bg-accent focus-ring"
        classList={{ "bg-accent": props.active }}
      >
        <Show
          when={avatarUrl()}
          fallback={
            <div class="grid size-8 shrink-0 place-items-center rounded-full bg-input text-xs text-foreground">
              {initial()}
            </div>
          }
        >
          {(url) => (
            <img
              src={url()}
              alt=""
              class="size-8 shrink-0 rounded-full object-cover"
            />
          )}
        </Show>
        <div class="flex min-w-0 flex-1 flex-col justify-center">
          <span class="truncate text-xs font-450 text-foreground">
            {displayName()}
          </span>
          <span class="truncate text-xxs text-muted-foreground">
            {planLabel()}
          </span>
        </div>
      </button>
    </div>
  );
}
