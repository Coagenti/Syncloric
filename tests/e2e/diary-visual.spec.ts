import { it, expect } from "vitest";
import { expect as pw } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { diaryUrl, withDiaryBrowser } from "./helpers/diary-harness";

it.skipIf(process.env.DIARY_VISUAL_CSS !== "1")("production CSS: prefilled food/recipe edit dialogs fit mobile and desktop", async () => {
  await withDiaryBrowser(async page => {
    const entries = ["food", "recipe"].map(type => ({ id: type, date: "2026-09-29", slot: "Lunch", entryType: type, name: type === "food" ? "Yogurt" : "Pasta al pomodoro", quantityGrams: type === "food" ? 125 : null, servings: type === "recipe" ? 2 : null, foodId: type === "food" ? "food-1" : null, recipeId: type === "recipe" ? "recipe-1" : null, kcal: 320, source: "manual", norishDeleted: false, protein: null, carbs: null, fat: null }));
    await page.route("**/api/v1/**", route => route.fulfill({ json: route.request().url().includes("/catalog") ? { foods: [], recipes: [{ id: "recipe-1", name: "Pasta al pomodoro", servings: 4, kcalPerServing: 160 }] } : { entries, sync: null, target: null } }));
    await page.goto(diaryUrl(page));
    const dir = process.env.DIARY_EVIDENCE_DIR ?? "../diary-ui-evidence";
    await mkdir(dir, { recursive: true });
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      for (const type of ["food", "recipe"]) {
        const trigger = page.locator(`[data-edit-id="${type}"]`);
        await trigger.click();
        const dialog = page.getByRole("dialog", { name: "Modifica voce" });
        const geometry = await dialog.evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, scroll: el.scrollWidth, client: el.clientWidth }; });
        expect(geometry.left).toBeGreaterThanOrEqual(8);
        expect(geometry.right).toBeLessThanOrEqual(width - 8);
        expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);
        await dialog.getByRole("button", { name: "Chiudi" }).focus();
        await page.screenshot({ path: `${dir}/${width}-edit-${type}.png` });
        await page.keyboard.press("Escape");
        await pw(trigger).toBeFocused();
      }
    }
  });
}, 600000);

it.skipIf(process.env.DIARY_VISUAL_CSS !== "1")("production CSS: dedicated manual/recipe views reflow320/390/1440 and show visible keyboard focus",async()=>{
 await withDiaryBrowser(async page=>{
  await page.route("**/api/v1/**",route=>route.fulfill({json:route.request().url().includes("/catalog")?{foods:[],recipes:[{id:"recipe-1",name:"Ricetta con un nome molto lungo per controllare la leggibilità",kcalPerServing:null}]}:route.request().url().includes("/frequent")?{foods:[]}:{entries:[],sync:null,target:null}}));
  const dir=process.env.DIARY_EVIDENCE_DIR??"test-results/diary-ui-evidence";await mkdir(dir,{recursive:true});const report:unknown[]=[];
  for(const width of [320,390,1440]){
   await page.setViewportSize({width,height:844});await page.goto(diaryUrl(page)+"/diary/add?date=2026-09-29&slot=Lunch");
   for(const type of ["food","recipe"]){
    if(type==="food")await page.getByRole("button",{name:"Inserisci un alimento manualmente"}).click();
    else{await page.locator(".entry-recipes summary").click();await page.getByRole("button",{name:"Scegli Ricetta con un nome molto lungo per controllare la leggibilità",exact:true}).click();}
    const geometry=await page.locator(".food-detail").evaluate(el=>({scroll:el.scrollWidth,client:el.clientWidth,page:document.documentElement.scrollWidth}));expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);expect(geometry.page).toBeLessThanOrEqual(width);
    await page.getByRole("button",{name:"Aggiungi a Pranzo",exact:true}).focus();const outline=await page.locator(":focus").evaluate(el=>getComputedStyle(el).outlineWidth);expect(parseFloat(outline)).toBeGreaterThanOrEqual(3);
    await page.screenshot({path:dir+"/"+width+"-entry-"+type+".png",fullPage:true});report.push({width,type,geometry});await page.getByRole("button",{name:"Torna alla selezione"}).click();
   }
  }
  await writeFile(dir+"/entry-visual-report.json",JSON.stringify(report,null,2));
 });
},90_000);
