import type { SVGProps } from "react";
import { themeIconPaths } from "./theme-icon-paths";

const paths = {
  copy: "M8 8h12v13H8z M16 8V3H3v13h5",
  check: "M5 12l4 4L19 6",
  tag: "M3 3h8l10 10-8 8L3 11z M7 7h.01",
  palette: "M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h2a6 6 0 0 0 0-12z M7 10h.01 M9 6h.01 M14 6h.01 M6 14h.01",
  language: "M3 5h12 M9 3v2 M6 5c0 5 3 8 7 10 M12 5c0 5-3 9-8 11 M14 21l4-10 4 10 M15.5 17h5",
  profile: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M4 22v-2a8 8 0 0 1 16 0v2",
  shield: "M12 3l8 3v6c0 5-4 8-8 10-4-2-8-5-8-10V6z M8 12l3 3 5-6",
  target: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12 M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4",
  search: "M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15 M16 16l5 5",
  camera: "M3 7h4l2-3h6l2 3h4v14H3z M12 10a4 4 0 1 0 0 8 4 4 0 0 0 0-8",
  family: "M8 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M2 21v-4a6 6 0 0 1 12 0v4 M16 14a6 6 0 0 1 6 6v1",
  share: "M16 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M5 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M16 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M8 10l5-4 M8 14l5 4",
  dashboard: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  diary: "M5 3h14v18H5z M9 8h6 M9 12h6 M9 16h4",
  calendar: "M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16 M8 14h2 M14 14h2",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z",
  logout: "M10 4H4v16h6 M14 8l4 4-4 4 M8 12h12",
  plus: "M12 5v14 M5 12h14",
  download: "M12 3v12 M7 10l5 5 5-5 M5 17v4h14v-4",
  left: "M14 6l-6 6 6 6",
  right: "M10 6l6 6-6 6",
  sync: "M20 7v5h-5 M4 17v-5h5 M6 7a7 7 0 0 1 12-1l2 6 M4 12l2 6a7 7 0 0 0 12-1",
  pencil: "M14 5l5 5 M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15z M4 15l4 4",
  trash: "M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14 M10 11v6 M14 11v6",
  scan: "M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5 M7 8v8 M10 8v8 M14 8v8 M17 8v8 M3 12h18",
} as const;

export type UiIconName = keyof typeof paths;

/** Original angular glyphs for Arasaka Red, on the same 24-unit grid as the shared set. */
const arasakaPaths: Record<keyof typeof paths, string> = {
  copy: "M8 8h10l3 3v10H8Z M3 15V3h12v3 M12 12h5 M12 16h5",
  check: "M4 12h4l3 5L21 5",
  tag: "M3 3h9l9 9-9 9-9-9Z M7 7h2v2H7Z",
  palette: "M3 3h18v14h-8l-3 4H3Z M7 7h2v2H7Z M14 7h3 M7 13h10",
  language: "M3 4h10v9H3Z M7 2v2 M5 7h6 M8 7l-3 4 M7 9l4 2 M14 21l3-13 4 13 M15 17h5",
  profile: "M9 3h6l3 3v5l-3 3H9l-3-3V6Z M4 22v-4l5-2h6l5 2v4 M9 19h6",
  shield: "M4 3h16v10l-8 8-8-8Z M8 11l3 3 6-6",
  target: "M8 3h8l5 5v8l-5 5H8l-5-5V8Z M8 8h8v8H8Z M12 1v5 M12 18v5 M1 12h5 M18 12h5",
  search: "M7 3h7l4 4v7l-4 4H7l-4-4V7Z M16 16l5 5 M7 7h7",
  camera: "M3 7h4l2-4h6l2 4h4v14H3Z M9 10h6l3 3v3l-3 3H9l-3-3v-3Z M18 9h1",
  family: "M5 4h5v6H5Z M15 5h5v6h-5Z M2 21v-6l3-2h5l3 2v6 M15 14h5l2 3v4 M5 17h5",
  share: "M15 2h6v6h-6Z M3 9h6v6H3Z M15 16h6v6h-6Z M9 10l6-5 M9 14l6 5",
  dashboard: "M3 3h18v18H3Z M7 17v-5h2v5 M11 17V7h2v10 M15 17v-8h2v8",
  diary: "M5 3h12l3 3v15H5Z M2 7h6 M2 12h6 M2 17h6 M10 8h6 M10 12h6 M10 16h4",
  calendar: "M3 5h18v16H3Z M7 2v6 M17 2v6 M3 10h18 M7 13h3v3H7Z M14 13h3 M14 17h3",
  settings: "M7 5h10l2 2v10l-2 2H7l-2-2V7Z M9 9h6v6H9Z M9 1v4 M15 1v4 M9 19v4 M15 19v4 M1 9h4 M1 15h4 M19 9h4 M19 15h4",
  logout: "M10 3H3v18h7 M13 7l6 5-6 5 M8 12h13",
  plus: "M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7Z",
  download: "M10 3h4v9h4l-6 6-6-6h4Z M3 17v5h18v-5",
  left: "M15 4l-8 8 8 8 M7 12h14",
  right: "M9 4l8 8-8 8 M3 12h14",
  sync: "M20 8V3h-5 M4 16v5h5 M20 3l-4 4H7L3 11 M4 21l4-4h9l4-4",
  pencil: "M3 17 16 4l4 4L7 21H3Z M13 7l4 4 M3 17l4 4 M17 3l4 4",
  trash: "M3 6h18 M8 6V3h8v3 M5 6l1 15h12l1-15 M9 10v7 M15 10v7",
  scan: "M8 2H2v6 M16 2h6v6 M2 16v6h6 M22 16v6h-6 M6 8v8 M10 6v12 M14 8v8 M18 6v12 M4 12h16",
};

export function UiIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: UiIconName }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <g className="ui-icon-standard"><path d={paths[name]} /></g>
    <g className="ui-icon-cyberpunk" strokeLinecap="square" strokeLinejoin="miter" strokeWidth="1.5"><path d={themeIconPaths.cyberpunk[name]} /><path className="ui-icon-cyberpunk-accent" d="M18 2h4v4" /></g>
    <g className="ui-icon-synthwave"><path d={themeIconPaths.synthwave[name]} /><circle className="ui-icon-synthwave-accent" cx="20" cy="4" r="1.2" /></g>
    <g className="ui-icon-terminal" strokeLinecap="butt" strokeLinejoin="miter" strokeWidth="1.6"><path d={themeIconPaths.terminal[name]} /></g>
    <g className="ui-icon-arasaka" strokeLinecap="square" strokeLinejoin="miter" strokeWidth="1.5"><path d={arasakaPaths[name]} /><path className="ui-icon-arasaka-accent" d="M20 2h2v2h-2Z" /></g>
  </svg>;
}
