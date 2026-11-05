import { it, expect } from "vitest";
import { expect as pw } from "@playwright/test";
import { diaryUrl, withDiaryBrowser } from "./helpers/diary-harness";
it("adds manual food, recipe and catalog food from dedicated views; edits recipes with focus restoration", async () => {
  await withDiaryBrowser(async page => {
    const entries: Record<string, unknown>[] = [], writes: Record<string, unknown>[] = [];
    const rice = { id: "food-rice", name: "Riso", brand: null, kcalPer100g: 200, nutrientsPer100g: {}, portions: [] };
    await page.route("**/api/v1/**", async route => {
      const req=route.request(), path=new URL(req.url()).pathname;
      if(path.endsWith("/catalog")) return route.fulfill({json:{foods:[],recipes:[{id:"recipe-1",name:"Pasta",kcalPerServing:320}]}});
      if(path.endsWith("/frequent")) return route.fulfill({json:{foods:[]}});
      if(path.endsWith("/search")) return route.fulfill({json:{local:[rice],foods:[],hasMore:false}});
      if(path.endsWith("/foods/food-rice")) return route.fulfill({json:{food:rice}});
      if(req.method()==="POST") {
        const body=req.postDataJSON();writes.push(body);
        entries.push({...body,entryType:body.entryType??"food",name:body.name??(body.foodId?"Riso":"Pasta"),kcal:body.kcalPer100g!==undefined?Math.round(body.kcalPer100g*body.quantityGrams/100):body.foodId?Math.round(body.quantityGrams*2):Math.round(body.servings*320),id:"entry-"+entries.length,source:"manual",norishDeleted:false,recipeId:body.recipeId??null});
        return route.fulfill({status:201,json:{entry:entries.at(-1)}});
      }
      if(req.method()==="PATCH"){const body=req.postDataJSON();writes.push(body);Object.assign(entries[1],body,{kcal:Math.round(body.servings*320)});return route.fulfill({json:{entry:entries[1]}});}
      return route.fulfill({json:{entries,sync:null,target:null}});
    });
    await page.goto(diaryUrl(page)+"/diary");await page.locator('[data-add-slot="Lunch"]').click();
    await pw(page).toHaveURL(/\/diary\/add\?date=2026-09-29&slot=Lunch/);
    await pw(page.getByRole("dialog")).toHaveCount(0);await pw(page.getByRole("searchbox",{name:"Cerca alimento per nome",exact:true})).not.toBeFocused();
    await page.getByLabel("Pasto",{exact:true}).selectOption("Snack");
    await page.getByRole("button",{name:"Inserisci un alimento manualmente"}).click();
    await page.getByLabel("Nome alimento",{exact:true}).fill("Yogurt");await page.getByLabel("Quantità in grammi",{exact:true}).fill("125");await page.getByLabel("Kcal per 100 g",{exact:true}).fill("64");
    await page.getByRole("button",{name:"Aggiungi a Spuntino",exact:true}).click();await pw(page.getByRole("status")).toContainText("Yogurt aggiunto");
    expect(writes[0]).toMatchObject({date:"2026-09-29",slot:"Snack",name:"Yogurt",quantityGrams:125,kcalPer100g:64});
    await page.getByRole("link",{name:"Fine",exact:true}).click();await pw(page.getByRole("region",{name:"Spuntino",exact:true}).locator(".meal-energy")).toContainText("80");
    await page.locator('[data-add-slot="Lunch"]').click();await page.locator(".entry-recipes summary").click();await page.getByRole("button",{name:"Scegli Pasta",exact:true}).click();
    await page.getByLabel("Numero di porzioni",{exact:true}).fill("2,5");await page.getByRole("button",{name:"Aggiungi a Pranzo",exact:true}).click();await pw(page.getByRole("status")).toContainText("Pasta aggiunto");
    await page.getByRole("link",{name:"Fine",exact:true}).click();
    await page.getByRole("link",{name:"Apri Pranzo",exact:true}).click();const row=page.locator(".entry-row").filter({hasText:"Pasta"}),edit=row.getByRole("button",{name:"Modifica",exact:true});await edit.click();
    const editor=page.getByRole("dialog",{name:"Modifica voce"});await editor.getByLabel("Numero di porzioni").fill("1");await editor.getByLabel("Pasto",{exact:true}).selectOption("Dinner");await editor.getByRole("button",{name:"Salva voce",exact:true}).click();await pw(page.locator('[data-add-slot="Lunch"]')).toBeFocused();
    await page.locator('[data-add-slot="Lunch"]').click();await page.getByRole("searchbox",{name:"Cerca alimento per nome",exact:true}).fill("Ri");await page.getByRole("button",{name:"Scegli Riso",exact:true}).click();await page.getByLabel("Quantità in grammi",{exact:true}).fill("150");await pw(page.locator(".food-energy-readout")).toContainText("300");await page.getByRole("button",{name:"Aggiungi a Pranzo",exact:true}).click();await pw(page.getByRole("status")).toContainText("Riso aggiunto");
    expect(writes[3]).toMatchObject({foodId:"food-rice",quantityGrams:150,slot:"Lunch"});
  });
},60_000);
