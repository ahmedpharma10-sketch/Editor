/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  deleteProject,
  duplicateProject,
  listRecentProjects,
  setProjectName,
  setProjectThumbnail,
  DEFAULT_PROJECT_ID,
  type ProjectEntry,
} from "@/components/engine/db";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { TextField, TextFieldInput } from "@/components/ui/text-field";
import { toast } from "somoto";
import { For, Show, batch, createMemo, createResource, createSignal, onCleanup, onMount } from "solid-js";
import { useSearchParams } from "@solidjs/router";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectPortal,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DashboardCardMeta,
  DashboardCardButton,
  DashboardCardPreview,
  DashboardViewSection,
} from "./shared";
import { DashboardSearchPanel } from "./search-bar";
import { useProjectId } from "@/hooks/use-project-id";
import { captureCanvasThumbnail } from "../engine/thumbnail";
import { MAIN_CANVAS_ID } from "../canvas";
import { Icon } from "../ui/icon";
import { nanoid } from "nanoid";
import { track } from "@/lib/analytics";

import type { ProjectSortOption } from "./types";

export function DashboardProjectsView() {
  const projectId = useProjectId();
  const [, setParams] = useSearchParams();
  const [search, setSearch] = createSignal("");
  const [sort, setSort] = createSignal<ProjectSortOption>("last-viewed");
  const [projects, { refetch: refetchProjects }] = createResource(() => listRecentProjects(32));
  const [contextMenuProjectId, setContextMenuProjectId] = createSignal<string | null>(null);
  const [renamingProjectId, setRenamingProjectId] = createSignal<string | null>(null);
  const [renameDraft, setRenameDraft] = createSignal("");

  const selectedSortOption = () =>
    SORT_OPTIONS.find((option) => option.id === sort()) ?? SORT_OPTIONS[0];

  const normalizedSearch = createMemo(() => search().trim().toLowerCase());

  onMount(async () => {
    if (projectId() == DEFAULT_PROJECT_ID) return;

    const canvas = document.getElementById(MAIN_CANVAS_ID) as HTMLCanvasElement;
    const blob = await captureCanvasThumbnail(canvas);
    if (blob) {
      setProjectThumbnail(projectId(), blob);
      refetchProjects();
    };
  })

  const filteredProjects = createMemo(() => {
    const query = normalizedSearch();
    const entries = projects() ?? [];
    if (!query) return entries;

    return entries.filter((project) => project.name.toLowerCase().includes(query));
  });

  const sortedProjects = createMemo(() => {
    const sortMode = sort();
    const entries = [...filteredProjects()];

    if (sortMode === "alphabetical") {
      entries.sort((a, b) => a.name.localeCompare(b.name));
      return entries;
    }

    if (sortMode === "date-created") {
      entries.sort((a, b) => parseTimestamp(b.createdAt) - parseTimestamp(a.createdAt));
      return entries;
    }

    entries.sort((a, b) => parseTimestamp(b.lastAccessedAt) - parseTimestamp(a.lastAccessedAt));
    return entries;
  });

  const openProject = (projectId: string) => {
    if (renamingProjectId() === projectId) return;

    track('project_opened');
    setParams({ project: projectId, dashboard: undefined }, { replace: true });
  };

  const startRenaming = (project: ProjectEntry) => {
    batch(() => {
      setRenameDraft(project.name);
      setRenamingProjectId(project.id);
    });
  };

  const handleDelete = async (project: ProjectEntry) => {
    try {
      await deleteProject(project.id);
      track('project_deleted');
      refetchProjects();
    } catch {
      toast.error("Failed to delete project");
    }
  };

  const handleDuplicate = async (project: ProjectEntry) => {
    try {
      await duplicateProject(project.id);
      track('project_duplicated');
      refetchProjects();
    } catch {
      toast.error("Failed to duplicate project");
    }
  };

  const handleRenameInput = (event: InputEvent & { currentTarget: HTMLInputElement }) => {
    setRenameDraft(event.currentTarget.value);
  };

  const handleFocusRenameInput = (event: FocusEvent & { currentTarget: HTMLInputElement }) => {
    event.currentTarget.select();
  };

  const handleBlurRenameInput = () => {
    batch(() => {
      setRenamingProjectId(null);
      setRenameDraft("");
    });
    refetchProjects();
  };

  const handleKeyDownRenameInput = async (event: KeyboardEvent, projectId: string) => {
    const input = event.currentTarget as HTMLInputElement;
    const trimmedName = renameDraft()?.trim() ?? "";

    if (event.key === "Escape") {
      refetchProjects();
      setRenamingProjectId(null);
      setRenameDraft("");

      event.preventDefault();
      event.stopPropagation();
      input.blur();
    }

    if (event.key == "Enter") {
      event.preventDefault();
      event.stopPropagation();

      if (trimmedName.length > 0 && projectId === renamingProjectId()) {
        await setProjectName(projectId, trimmedName);
      }

      refetchProjects();
      setRenamingProjectId(null);
      setRenameDraft("");

      input.blur();
    };
  };

  const handleCreateProject = () => {
    track('project_created');
    setParams({
      project: nanoid(),
      dashboard: undefined
    }, { replace: true });
  };

  return (
    <DashboardSearchPanel
      value={search}
      onChange={setSearch}
      placeholder="Search in projects"
    >
      <DashboardViewSection
        title="Recent projects"
        controls={
          <Select<(typeof SORT_OPTIONS)[number]>
            options={SORT_OPTIONS}
            value={selectedSortOption()}
            onChange={(option) => option && setSort(option.id)}
            optionValue="id"
            optionTextValue="label"
            itemComponent={(itemProps) => (
              <SelectItem item={itemProps.item}>
                {itemProps.item.rawValue.label}
              </SelectItem>
            )}
          >
            <SelectTrigger aria-label="Sort projects">
              <SelectValue<(typeof SORT_OPTIONS)[number]>>
                {(state) => state.selectedOption()?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectPortal>
              <SelectContent />
            </SelectPortal>
          </Select>
        }
      >
        <DashboardCardButton onClick={handleCreateProject} class="hover:bg-background">
          <DashboardCardPreview class="bg-background group-hover:bg-accent group-hover:border-input">
            <Icon
              name="plus-add"
              class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-muted-foreground"
            />
          </DashboardCardPreview>
          <DashboardCardMeta title="New project" />
        </DashboardCardButton>
        <For each={sortedProjects().filter(project => project.id !== DEFAULT_PROJECT_ID).slice(0, MAX_VISIBLE_PROJECTS)}>
          {(project) => (
            <ContextMenu
              modal={false}
              onOpenChange={(open) => {
                setContextMenuProjectId((current) => {
                  if (open) return project.id;
                  return current === project.id ? null : current;
                });
              }}
            >
              <ContextMenuTrigger as="div" class="contents">
                <DashboardCardButton
                  active={contextMenuProjectId() === project.id}
                  onClick={() => openProject(project.id)}
                >
                  <DashboardCardPreview>
                    <ProjectThumbnail thumbnail={project.thumbnail} />
                  </DashboardCardPreview>
                  <div class="flex flex-col gap-1 px-2">
                    <div class="relative h-4 w-full">
                      <Show
                        when={renamingProjectId() === project.id}
                        fallback={
                          <p class="min-w-0 truncate text-xs text-foreground">
                            {project.name}
                          </p>
                        }
                      >
                        <TextField class="contents">
                          <TextFieldInput
                            uiSize="compact"
                            type="text"
                            value={renameDraft()}
                            onInput={handleRenameInput}
                            onFocus={handleFocusRenameInput}
                            onBlur={handleBlurRenameInput}
                            onKeyDown={(e: KeyboardEvent) => handleKeyDownRenameInput(e, project.id)}
                            placeholder="Project name"
                            aria-label="Project name"
                            class="absolute left-1/2 top-1/2 h-5 w-56 -translate-x-1/2 -translate-y-1/2 border border-ring bg-input px-1 py-0 ring-1 ring-inset ring-ring"
                          />
                        </TextField>
                      </Show>
                    </div>
                    <p class="min-w-0 truncate text-xs text-muted-foreground">
                      {formatEditedAt(project.lastAccessedAt)}
                    </p>
                  </div>
                </DashboardCardButton>
              </ContextMenuTrigger>
              <ContextMenuPortal>
                <ContextMenuContent class="w-45 gap-0">
                  <ContextMenuItem onSelect={() => openProject(project.id)}>
                    Open
                  </ContextMenuItem>
                  <ContextMenuSeparator class="my-2" />
                  <ContextMenuItem onSelect={() => startRenaming(project)}>
                    Rename
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => handleDuplicate(project)}>
                    Duplicate
                  </ContextMenuItem>
                  <ContextMenuSeparator class="my-2" />
                  <ContextMenuItem onSelect={() => handleDelete(project)}>
                    Delete
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenuPortal>
            </ContextMenu>
          )}
        </For>
      </DashboardViewSection>
    </DashboardSearchPanel>
  );
}

function ProjectThumbnail(props: { thumbnail?: Blob }) {
  const url = createMemo(() => {
    if (!props.thumbnail) return null;
    return URL.createObjectURL(props.thumbnail);
  });

  onCleanup(() => {
    const u = url();
    if (u) URL.revokeObjectURL(u);
  });

  return (
    <Show when={url()}>
      <img
        src={url()!}
        alt=""
        class="h-full w-full object-cover"
        draggable={false}
      />
    </Show>
  );
}

const SORT_OPTIONS: Array<{ id: ProjectSortOption; label: string }> = [
  { id: "last-viewed", label: "Last viewed" },
  { id: "alphabetical", label: "Alphabetical" },
  { id: "date-created", label: "Date created" },
];

const MAX_VISIBLE_PROJECTS = 11;

function parseTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatEditedAt(lastAccessedAt: string): string {
  const timestamp = parseTimestamp(lastAccessedAt);
  if (!timestamp) return "Edited just now";

  const elapsedMs = Date.now() - timestamp;
  if (elapsedMs < 60_000) return "Edited just now";

  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return `Edited ${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Edited ${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `Edited ${days} day${days === 1 ? "" : "s"} ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `Edited ${months} month${months === 1 ? "" : "s"} ago`;

  const years = Math.floor(days / 365);
  return `Edited ${years} year${years === 1 ? "" : "s"} ago`;
}
