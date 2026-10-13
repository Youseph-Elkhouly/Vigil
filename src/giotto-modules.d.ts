declare module "giotto/player" {}
declare module "giotto/render" {
  export function toSvg(doc: import("./shared/giotto").Diagram, style?: unknown, options?: unknown): string;
  export function layoutWarnings(doc: unknown, style?: unknown): string[];
}
declare module "giotto/figure" {
  export function figureSvg(doc: import("./shared/giotto").Diagram, style?: unknown, options?: {theme?: string; animated?: boolean}): string;
  export function readFigure(svg: string): import("./shared/giotto").Diagram | null;
}
declare module "giotto/edit" {
  export function applyEdit(doc: import("./shared/giotto").Diagram, edit: unknown): import("./shared/giotto").Diagram;
}
