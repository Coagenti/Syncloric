import { it, expect } from "vitest";
import { expect as pw } from "@playwright/test";
import { diaryUrl, withDiaryBrowser } from "./helpers/diary-harness";
it("debounces and aborts old searches, hides raw catalog parsing errors",async()=>{
 await withDiaryBrowser(async page=>{
  const queries:string[]=[];let release:(()=>void)|undefined;
  await page.route("**/api/v1/**",async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith("/catalog"))return route.fulfill({body:"raw SQL password",contentType:"application/json"});
    if(url.pathname.endsWith("/frequent"))return route.fulfill({json:{foods:[]}});
    if(url.pathname.endsWith("/search")){const query=url.searchParams.get("query")!;queries.push(query);if(query==="Ri")await new Promise<void>(r=>{release=r;});return route.fulfill({json:{local:[],foods:[{barcode:query==="Ri"?"8001234567890":"8001234567891",name:query==="Ri"?"Riso vecchio":"Pasta attuale",brand:null,kcalPer100g:200,nutrientsPer100g:{},portions:[]}],hasMore:false}}).catch(()=>{});}
    return route.fulfill({json:{entries:[],sync:null,target:null}});
  });
  await page.goto(diaryUrl(page)+"/diary/add?date=2026-09-29&slot=Lunch");
  await pw(page.locator("body")).not.toContainText("SQL");
  const search=page.getByRole("searchbox");await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+2000));
  await search.fill("R");await search.fill("Ri");await page.clock.runFor(899);expect(queries).toEqual([]);await page.clock.runFor(1);await pw.poll(()=>queries).toEqual(["Ri"]);
  await search.fill("Pa");await page.clock.runFor(900);await pw(page.getByRole("button",{name:"Scegli Pasta attuale",exact:true})).toBeVisible();release?.();await pw(page.getByRole("button",{name:"Scegli Riso vecchio",exact:true})).toHaveCount(0);
 });
},60_000);
it("dashboard refreshes fractional recipe additions and preserves unknown calories",async()=>{
 await withDiaryBrowser(async page=>{
  const entries:unknown[]=[];
  await page.route("**/api/v1/**",route=>{
   const req=route.request();
   if(req.url().includes("/catalog"))return route.fulfill({json:{foods:[],recipes:[{id:"known",name:"Pasta",kcalPerServing:320},{id:"unknown",name:"Zuppa",kcalPerServing:null}]}});
   if(req.url().includes("/frequent"))return route.fulfill({json:{foods:[]}});
   if(req.method()==="POST"){const body=req.postDataJSON(),unknown=body.recipeId==="unknown";entries.push({...body,id:String(entries.length),name:unknown?"Zuppa":"Pasta",source:"manual",kcal:unknown?null:480,norishDeleted:false});return route.fulfill({status:201,json:{}});}
   return route.fulfill({json:{entries,sync:null,target:2000}});
  });
  for(const name of ["Pasta","Zuppa"]){await page.goto(diaryUrl(page)+"/diary/add?date=2026-09-29&slot=Lunch");await page.locator(".entry-recipes summary").click();await page.getByRole("button",{name:"Scegli "+name,exact:true}).click();await page.getByLabel("Numero di porzioni").fill("1.5");if(name==="Zuppa")await pw(page.locator(".food-energy-readout")).toContainText("—");await page.getByRole("button",{name:"Aggiungi a Pranzo",exact:true}).click();await pw(page.getByRole("status")).toContainText(name+" aggiunto");}
  await page.goto(diaryUrl(page)+"/dashboard");await pw(page.locator(".energy-number")).toHaveText("480");await pw(page.locator(".energy-card")).toContainText("1 voce senza kcal definite");
 },"dashboard");
},60_000);
