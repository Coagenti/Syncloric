import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CalorieApp } from "@/components/calorie-app";
it("exposes Scansiona in the diary independently of feed loading", () => {
  expect(renderToStaticMarkup(<CalorieApp view="diary" />)).toContain("Scansiona");
});
