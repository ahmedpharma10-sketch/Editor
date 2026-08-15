/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { generateProjectName } from "@/components/engine/db";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import { TextField, TextFieldInput } from "@/components/ui/text-field";
import { toast } from "somoto";
import { For, Show, batch, createMemo, createResource, createSignal, onCleanup } from "solid-js";
import { useNavigate } from "@solidjs/router";

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
import { projectRoute } from "@/hooks/use-project-id";
import { Icon } from "../ui/icon";
import { track } from "@/lib/analytics";
import {
  createProject,
  deleteProject,
  duplicateProject,
  isDesktop,
  listProjects,
  pickProjectsRoot,
  projectsRoot,
  renameProject,
  type ProjectInfo,
} from "@/projects";

import type { ProjectSortOption } from "./types";

// Projects live on disk under a user-picked root (see @/projects); their
// package.json is the record. Thumbnails have no on-disk backing yet: the UI
// stays, the lookup is a no-op until the desktop host grows it.
async function getProjectThumbnail(_name: string): Promise<Blob | undefined> {
  return undefined;
}

export function DashboardProjectsView() {
  const navigate = useNavigate();
  const [search, setSearch] = createSignal("");
  const [sort, setSort] = createSignal<ProjectSortOption>("last-viewed");
  const [projects, { refetch: refetchProjects }] = createResource(projectsRoot, () => listProjects());
  const [contextMenuProject, setContextMenuProject] = createSignal<string | null>(null);
  const [renamingProject, setRenamingProject] = createSignal<string | null>(null);
  const [renameDraft, setRenameDraft] = createSignal("");

  const selectedSortOption = () =>
    SORT_OPTIONS.find((option) => option.id === sort()) ?? SORT_OPTIONS[0];

  const normalizedSearch = createMemo(() => search().trim().toLowerCase());

  const filteredProjects = createMemo(() => {
    const query = normalizedSearch();
    const entries = projects() ?? [];
    if (!query) return entries;

    return entries.filter((project) => project.displayName.toLowerCase().includes(query));
  });

  const sortedProjects = createMemo(() => {
    const sortMode = sort();
    const entries = [...filteredProjects()];

    if (sortMode === "alphabetical") {
      entries.sort((a, b) => a.displayName.localeCompare(b.displayName));
      return entries;
    }

    if (sortMode === "date-created") {
      entries.sort((a, b) => parseTimestamp(b.createdAt) - parseTimestamp(a.createdAt));
      return entries;
    }

    entries.sort((a, b) => parseTimestamp(b.modifiedAt) - parseTimestamp(a.modifiedAt));
    return entries;
  });

  const openProject = (project: ProjectInfo) => {
    if (renamingProject() === project.name) return;

    track('project_opened');
    navigate(projectRoute(project.name));
  };

  const startRenaming = (project: ProjectInfo) => {
    batch(() => {
      setRenameDraft(project.displayName);
      setRenamingProject(project.name);
    });
  };

  const handleDelete = async (project: ProjectInfo) => {
    try {
      await deleteProject(project.name);
      track('project_deleted');
      refetchProjects();
    } catch (e) {
      toast.error("Failed to delete project", { description: (e as Error).message });
    }
  };

  const handleDuplicate = async (project: ProjectInfo) => {
    try {
      await duplicateProject(project.name);
      track('project_duplicated');
      refetchProjects();
    } catch (e) {
      toast.error("Failed to duplicate project", { description: (e as Error).message });
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
      setRenamingProject(null);
      setRenameDraft("");
    });
    refetchProjects();
  };

  const handleKeyDownRenameInput = async (event: KeyboardEvent, projectName: string) => {
    const input = event.currentTarget as HTMLInputElement;
    const trimmedName = renameDraft()?.trim() ?? "";

    if (event.key === "Escape") {
      refetchProjects();
      setRenamingProject(null);
      setRenameDraft("");

      event.preventDefault();
      event.stopPropagation();
      input.blur();
    }

    if (event.key == "Enter") {
      event.preventDefault();
      event.stopPropagation();

      if (trimmedName.length > 0 && projectName === renamingProject()) {
        try {
          await renameProject(projectName, trimmedName);
        } catch (e) {
          toast.error("Failed to rename project", { description: (e as Error).message });
        }
      }

      refetchProjects();
      setRenamingProject(null);
      setRenameDraft("");

      input.blur();
    };
  };

  const handleChooseRoot = async () => {
    if (!isDesktop()) {
      toast.error("Projects on disk are only available in the desktop app");
      return;
    }
    try {
      await pickProjectsRoot();
    } catch (e) {
      toast.error("Failed to choose projects folder", { description: (e as Error).message });
    }
  };

  const handleCreateProject = async () => {
    if (!projectsRoot()) {
      await handleChooseRoot();
      if (!projectsRoot()) return;
    }

    try {
      const displayName = generateProjectName();
      const project = await createProject(folderName(displayName), displayName);
      track('project_created');
      refetchProjects();
      openProject(project);
    } catch (e) {
      toast.error("Failed to create project", { description: (e as Error).message });
    }
  };

  return (
    <DashboardSearchPanel
      value={search}
      onChange={setSearch}
      placeholder="Search in projects"
    >
      <DashboardViewSection
        class="pb-4"
        title="Recent projects"
        controls={
          <>
            <Button variant="ghost" onClick={handleChooseRoot} title={projectsRoot() ?? undefined}>
              <Icon name="navigation.folder" class="mr-1 size-4" />
              {projectsRoot() ? folderLabel(projectsRoot()!) : "Choose projects folder"}
            </Button>
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
          </>
        }
      >
        <DashboardCardButton onClick={handleCreateProject}>
          <DashboardCardPreview class="bg-accent/50 group-hover:bg-accent group-hover:border-input">
            <Icon
              name="plus-add"
              class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-muted-foreground"
            />
          </DashboardCardPreview>
          <DashboardCardMeta title="New project" />
        </DashboardCardButton>
        <For each={sortedProjects().slice(0, MAX_VISIBLE_PROJECTS)}>
          {(project) => (
            <ContextMenu
              modal={false}
              onOpenChange={(open) => {
                setContextMenuProject((current) => {
                  if (open) return project.name;
                  return current === project.name ? null : current;
                });
              }}
            >
              <ContextMenuTrigger as="div" class="contents">
                <DashboardCardButton
                  active={contextMenuProject() === project.name}
                  onClick={() => openProject(project)}
                >
                  <DashboardCardPreview>
                    <ProjectThumbnail name={project.name} />
                  </DashboardCardPreview>
                  <div class="flex flex-col gap-1 px-2">
                    <div class="relative h-4 w-full">
                      <Show
                        when={renamingProject() === project.name}
                        fallback={
                          <p class="min-w-0 truncate text-xs text-foreground">
                            {project.displayName}
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
                            onKeyDown={(e: KeyboardEvent) => handleKeyDownRenameInput(e, project.name)}
                            placeholder="Project name"
                            aria-label="Project name"
                            class="absolute left-1/2 top-1/2 h-5 w-56 -translate-x-1/2 -translate-y-1/2 border border-ring bg-input px-1 py-0 ring-1 ring-inset ring-ring"
                          />
                        </TextField>
                      </Show>
                    </div>
                    <p class="min-w-0 truncate text-xs text-muted-foreground">
                      {formatEditedAt(project.modifiedAt)}
                    </p>
                  </div>
                </DashboardCardButton>
              </ContextMenuTrigger>
              <ContextMenuPortal>
                <ContextMenuContent class="w-45 gap-0">
                  <ContextMenuItem onSelect={() => openProject(project)}>
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

function ProjectThumbnail(props: { name: string }) {
  const [thumbnail] = createResource(() => props.name, getProjectThumbnail);
  const url = createMemo(() => {
    const blob = thumbnail();
    if (!blob) return null;
    return URL.createObjectURL(blob);
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
  { id: "last-viewed", label: "Last modified" },
  { id: "alphabetical", label: "Alphabetical" },
  { id: "date-created", label: "Date created" },
];

const MAX_VISIBLE_PROJECTS = 11;

/** Folder-safe project name: "Golden River 15 Aug" -> "golden-river-15-aug". */
function folderName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "") || "project";
}

function folderLabel(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function parseTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatEditedAt(modifiedAt: string): string {
  const timestamp = parseTimestamp(modifiedAt);
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
