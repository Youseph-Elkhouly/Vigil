// Giotto render.js emits <g data-id="…">; player.js uses an open shadow root.
// Read only IDs present in the separately supplied evidence mapping.
export function selectionId(path: readonly unknown[], knownIds: ReadonlySet<string>): string | null {
  for (const item of path) {
    if (item && typeof (item as {getAttribute?: unknown}).getAttribute === "function") {
      const id=(item as {getAttribute(name: string): string | null}).getAttribute("data-id");
      if (id && knownIds.has(id)) return id;
    }
  }
  return null;
}
