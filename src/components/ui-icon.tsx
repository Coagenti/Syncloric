import type { SVGProps } from "react";

const paths = {
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
  left: "M14 6l-6 6 6 6",
  right: "M10 6l6 6-6 6",
  sync: "M20 7v5h-5 M4 17v-5h5 M6 7a7 7 0 0 1 12-1l2 6 M4 12l2 6a7 7 0 0 0 12-1",
  pencil: "M14 5l5 5 M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15z M4 15l4 4",
  trash: "M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14 M10 11v6 M14 11v6",
  scan: "M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5 M7 8v8 M10 8v8 M14 8v8 M17 8v8 M3 12h18",
} as const;

export function UiIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: keyof typeof paths }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name]} /></svg>;
}
