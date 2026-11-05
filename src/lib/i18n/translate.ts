import { english } from "./en";
import type { Locale } from "@/lib/ui-preferences";
export type TranslationValues = Readonly<Record<string, string | number>>;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = Object.entries(english).flatMap(([source, target]) => {
  if (!source.includes("{0}") || source.replace(/\{\w+\}/g, "").length < 12 || /\}\s*\{/.test(source)) return [];
  const names: string[] = []; let cursor = 0; let expression = "^";
  for (const match of source.matchAll(/\{(\w+)\}/g)) { expression += escape(source.slice(cursor, match.index)) + "([\\s\\S]{0,256}?)"; names.push(match[1]); cursor = match.index + match[0].length; }
  return [{ expression: new RegExp(expression + escape(source.slice(cursor)) + "$"), names, target }];
});
/** Translate interface copy only; product names and other user data remain untouched. */
export function translate(locale: Locale, message: string, values: TranslationValues = {}) {
  const key = message.trim().replace(/\s+/g, " ");
  let text = message; let parameters = values;
  if (locale === "en") {
    let translated = english[key];
    if (translated === undefined && key.length <= 2048) for (const pattern of patterns) {
      const match = pattern.expression.exec(key);
      if (match) { translated = pattern.target; parameters = { ...Object.fromEntries(pattern.names.map((name, index) => [name, match[index + 1]])), ...values }; break; }
    }
    if (translated !== undefined) text = (message.match(/^\s*/)?.[0] ?? "") + translated + (message.match(/\s*$/)?.[0] ?? "");
  }
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => parameters[name] === undefined ? placeholder : String(parameters[name]));
}
