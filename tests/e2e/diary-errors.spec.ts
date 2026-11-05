import { it, expect } from "vitest";
import { expect as pw } from "@playwright/test";
import { diaryUrl, withDiaryBrowser } from "./helpers/diary-harness";
it("feed parsing errors never expose server response text",async()=>{await withDiaryBrowser(async page=>{await page.route("**/api/v1/**",route=>route.fulfill({contentType:"application/json",body:"raw SQL password"}));await page.goto(diaryUrl(page));await pw(page.getByRole("alert")).toContainText("Impossibile caricare");await pw(page.locator("body")).not.toContainText("SQL");});},60_000);
it("preserves input, sanitizes failed writes, offers login and still supports owned food edits",async()=>{
 await withDiaryBrowser(async page=>{
  let status=400;const writes:unknown[]=[];
  const entry={id:"manual-1",name:"Yogurt",date:"2026-09-29",slot:"Snack",entryType:"food",quantityGrams:125,kcal:80,servings:null,foodId:null,recipeId:null,source:"manual",norishDeleted:false};
  await page.route("**/api/v1/**",route=>{
   const req=route.request();if(req.url().includes("/catalog"))return route.fulfill({json:{foods:[],recipes:[]}});if(req.url().includes("/frequent"))return route.fulfill({json:{foods:[]}});
   if(req.method()==="POST")return status===0?route.abort("failed"):route.fulfill({status,json:{error:"postgres password secret"}});
   if(req.method()==="PATCH"){const body=req.postDataJSON();writes.push(body);Object.assign(entry,body);return route.fulfill({json:{entry}});}
   return route.fulfill({json:{entries:[entry,{...entry,id:"import",name:"Importata",source:"norish_sync"}],sync:null,target:null}});
  });
  await page.goto(diaryUrl(page)+"/diary");await pw(page.locator(".entry-row").filter({hasText:"Importata"}).getByRole("button",{name:"Modifica",exact:true})).toHaveCount(0);
  await page.locator('[data-add-slot="Lunch"]').click();await page.getByRole("button",{name:"Inserisci un alimento manualmente"}).click();await page.getByLabel("Nome alimento",{exact:true}).fill("Nuovo");await page.getByLabel("Kcal per 100 g",{exact:true}).fill("64");
  const save=page.getByRole("button",{name:"Aggiungi a Pranzo",exact:true});
  await save.click();await pw(page.getByRole("alert")).toContainText("Controlla");await pw(page.locator("body")).not.toContainText("postgres");await pw(page.getByLabel("Nome alimento",{exact:true})).toHaveValue("Nuovo");
  status=500;await save.click();await pw(page.getByRole("alert")).toContainText("Non è stato possibile salvare");status=0;await save.click();await pw(page.getByRole("alert")).toContainText("Connessione al salvataggio interrotta");
  status=401;await save.click();await pw(page.getByRole("link",{name:"Accedi",exact:true})).toHaveAttribute("href","/login");
  await page.getByRole("link",{name:"Torna al diario",exact:true}).click();await page.getByRole("link",{name:"Apri Spuntino",exact:true}).click();const edit=page.locator(".entry-row").filter({hasText:"Yogurt"}).getByRole("button",{name:"Modifica",exact:true});await edit.click();
  const dialog=page.getByRole("dialog",{name:"Modifica voce"});await pw(dialog.getByLabel("Nome alimento",{exact:true})).toHaveAttribute("readonly","");await dialog.getByLabel("Quantità in grammi").fill("150");await dialog.getByLabel("Kcal totali",{exact:true}).fill("95");await dialog.getByRole("button",{name:"Salva voce",exact:true}).click();await pw(edit).toBeFocused();
  expect(writes).toEqual([{date:"2026-09-29",slot:"Snack",quantityGrams:150,kcal:95,nutrients:{},portion:null}]);
 });
},60_000);
