import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Utility pura condivisa: merge di classi Tailwind (pattern shadcn/HeroUI). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}