import { it, expect } from "vitest";
import { expect as pw } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { diaryUrl, withDiaryBrowser } from "./helpers/diary-harness";
const food={id:"aaaaaaaa-1111-4111-8111-111111111111",name:"Biscotti al cioccolato",brand:"Marca di esempio",kcalPer100g:450,nutrientsPer100g:{protein:8,carbs:60,fat:20},canEdit:true,portions:[{id:"bbbbbbbb-1111-4111-8111-111111111111",label:"Biscotto",grams:6,defaultQuantity:4},{id:"bbbbbbbb-2222-4222-8222-222222222222",label:"Pacchetto",grams:50,defaultQuantity:1}]};
it("defaults to unfocused search; tabs support keyboard; portions support comma decimals, defaults and save",async()=>{
 await withDiaryBrowser(async page=>{
  const writes:Record<string,unknown>[]=[];
  await page.route("**/api/v1/**",route=>{
   const req=route.request();if(req.url().includes("/frequent"))return route.fulfill({json:{foods:[food]}});
   if(req.url().includes("/catalog"))return route.fulfill({json:{foods:[],recipes:[]}});
   if(req.url().includes("/label-scan"))return route.fulfill({json:{ready:false,provider:null,cloud:false}});
   if(req.method()!=="GET"){writes.push(req.postDataJSON());return route.fulfill({status:201,json:{}});}
   return route.fulfill({json:{food}});
  });
  await page.goto(diaryUrl(page)+"/diary/add?date=2026-10-13&slot=Breakfast");
  await pw(page.getByRole("tab",{name:"Ricerca",exact:true})).toHaveAttribute("aria-selected","true");await pw(page.getByRole("searchbox")).not.toBeFocused();await pw(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("tab",{name:"Ricerca",exact:true}).press("ArrowRight");await pw(page.getByRole("tab",{name:"Scansione",exact:true})).toBeFocused();await pw(page.getByRole("button",{name:"Avvia fotocamera"})).toBeVisible();await page.getByRole("tab",{name:"Scansione",exact:true}).press("End");await pw(page.getByRole("tab",{name:"Etichetta AI",exact:true})).toBeFocused();await pw(page.getByText("AI non configurata o disabilitata. Compila il prodotto manualmente.")).toBeVisible();await page.getByRole("tab",{name:"Etichetta AI",exact:true}).press("Home");
  await page.getByRole("button",{name:"Scegli "+food.name,exact:true}).click();await pw(page.getByRole("heading",{name:food.name,exact:true})).toBeFocused();await pw(page.getByLabel("Quantità di porzioni")).toHaveValue("4");
  await page.getByLabel("Quantità di porzioni").fill("1,5");await pw(page.locator(".food-energy-readout")).toContainText("41");await pw(page.locator(".portion-equivalence")).toContainText("9 g");
  await page.getByLabel("Unità",{exact:true}).selectOption(food.portions[1].id);await pw(page.getByLabel("Quantità di porzioni")).toHaveValue("1");await pw(page.locator(".food-energy-readout")).toContainText("225");
  await page.getByLabel("Unità",{exact:true}).selectOption(food.portions[0].id);await page.getByLabel("Quantità di porzioni").fill("1,5");await page.getByRole("button",{name:"Aggiungi a Colazione",exact:true}).click();await pw(page.getByRole("status")).toContainText("aggiunto a colazione");
  expect(writes[0]).toMatchObject({foodId:food.id,slot:"Breakfast",date:"2026-10-13",quantityGrams:9,portion:{label:"Biscotto",grams:6,quantity:1.5},portions:food.portions});
 });
},60_000);
it("AI photo stays local until extraction, then requires verification before adding",async()=>{
 await withDiaryBrowser(async page=>{
  const writes:string[]=[];
  await page.route("**/api/v1/**",route=>{
   const req=route.request();if(req.method()==="POST")writes.push(new URL(req.url()).pathname);
   if(req.url().endsWith("/label-scan"))return route.fulfill({json:req.method()==="GET"?{ready:true,provider:"openai",cloud:true}:{label:{name:"Latte",brand:"Marca",per100g:{kcal:50,protein:3,carbs:5,fat:2},servingSize:200}}});
   if(req.url().includes("/catalog"))return route.fulfill({json:{foods:[],recipes:[]}});
   if(req.url().includes("/frequent"))return route.fulfill({json:{foods:[]}});
   return route.fulfill({status:req.method()==="POST"?201:200,json:{}});
  });
  await page.goto(diaryUrl(page)+"/diary/add?date=2026-10-13&slot=Snack#etichetta");
  await pw(page.locator(".ai-service-status")).toHaveText("AI attiva");await pw(page.locator(".ai-service-status")).toHaveAttribute("data-state","ready");await pw(page.getByText(/L’AI estrae automaticamente i valori/)).toBeVisible();await pw(page.getByRole("button",{name:"Fotografa o carica",exact:true})).toBeEnabled();
  await page.getByLabel("Foto etichetta").setInputFiles({name:"label.png",mimeType:"image/png",buffer:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ64AAAAASUVORK5CYII=","base64")});expect(writes).toEqual([]);
  await page.getByRole("button",{name:"Scansiona etichetta",exact:true}).click();await pw(page.getByRole("heading",{name:"Latte",exact:true})).toBeVisible();const add=page.getByRole("button",{name:"Aggiungi a Spuntino",exact:true});await pw(add).toBeDisabled();expect(writes).toEqual(["/api/v1/label-scan"]);await page.getByLabel("Ho verificato i valori proposti dall’AI").check();await add.click();await pw(page.locator(".entry-success")).toContainText("Latte aggiunto");expect(writes).toEqual(["/api/v1/label-scan","/api/v1/foods"]);await pw(page.getByRole("tab",{name:"Ricerca",exact:true})).toBeEnabled();
 });
},60_000);
it("editing fractional food portions derives calories from per100g without cumulative rounding",async()=>{
 await withDiaryBrowser(async page=>{
  const entry={id:"entry",foodId:food.id,date:"2026-10-13",slot:"Breakfast",name:food.name,entryType:"food",quantityGrams:9,kcal:41,nutrients:{protein:.72,carbs:5.4,fat:1.8},source:"manual",norishDeleted:false,portion:{label:"Biscotto",grams:6,quantity:1.5}};let payload:Record<string,unknown>|null=null;
  await page.route("**/api/v1/**",route=>{const req=route.request();if(req.method()==="PATCH"){payload=req.postDataJSON();return route.fulfill({json:{entry}});}if(req.url().includes("/foods/"))return route.fulfill({json:{food}});if(req.url().includes("/catalog"))return route.fulfill({json:{foods:[],recipes:[]}});return route.fulfill({json:{entries:[entry],sync:null,target:2000}});});
  await page.goto(diaryUrl(page)+"/diary?date=2026-10-13");await page.getByRole("button",{name:"Modifica",exact:true}).click();const editor=page.getByRole("dialog",{name:"Modifica voce"});await pw(editor.getByRole("combobox",{name:"Unità",exact:true})).toContainText("Pacchetto");await editor.getByLabel("Quantità di porzioni").fill("2");await pw(editor.getByLabel("Quantità in grammi")).toHaveValue("12");await pw(editor.getByLabel("Kcal totali",{exact:true})).toHaveValue("54");await editor.getByRole("button",{name:"Salva voce",exact:true}).click();await pw(editor).not.toBeVisible();expect(payload).toMatchObject({quantityGrams:12,kcal:54,portion:{label:"Biscotto",grams:6,quantity:2},nutrients:{protein:.96,carbs:7.2,fat:2.4}});
 });
},60_000);
it("switching method stops camera tracks; denied camera leaves manual entry available",async()=>{
 await withDiaryBrowser(async page=>{
  await page.addInitScript(()=>{
   const state={stops:0};Object.assign(window,{cameraTest:state});
   Object.defineProperty(navigator.mediaDevices,"getUserMedia",{configurable:true,value:async()=>{const canvas=document.createElement("canvas");canvas.width=100;canvas.height=100;const stream=canvas.captureStream();for(const track of stream.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{state.stops++;stop();};}return stream;}});
   Object.assign(window,{BarcodeDetector:class{async detect(){return [];}}});
  });
  await page.route("**/api/v1/**",route=>route.fulfill({json:{foods:[],recipes:[],ready:false}}));
  await page.goto(diaryUrl(page)+"/diary/add?date=2026-10-13&slot=Snack#scansione");await page.getByRole("button",{name:"Avvia fotocamera",exact:true}).click();await pw(page.getByRole("button",{name:"Ferma fotocamera",exact:true})).toBeVisible();await page.getByRole("tab",{name:"Ricerca",exact:true}).click();await pw.poll(()=>page.evaluate(()=>(window as unknown as {cameraTest:{stops:number}}).cameraTest.stops)).toBe(1);
  await page.getByRole("tab",{name:"Scansione",exact:true}).click();await page.evaluate(()=>{Object.defineProperty(navigator.mediaDevices,"getUserMedia",{configurable:true,value:async()=>{throw new DOMException("Denied","NotAllowedError");}});});await page.getByRole("button",{name:"Avvia fotocamera",exact:true}).click();await pw(page.getByRole("alert")).toContainText("negato");await pw(page.getByLabel("Codice a barre",{exact:true})).toBeEnabled();
 });
},60_000);
it.skipIf(process.env.DIARY_VISUAL_CSS!=="1")("production food entry views fit 320/390/1440 with saved and manual portions",async()=>{
 await withDiaryBrowser(async page=>{
  let aiReady=false;
  await page.route("**/api/v1/**",route=>route.fulfill({json:route.request().url().includes("/frequent")?{foods:[food]}:route.request().url().includes("/catalog")?{foods:[],recipes:[]}:{food,ready:aiReady,provider:aiReady?"openai":null,cloud:aiReady}}));
  const dir="test-results/food-entry";await mkdir(dir,{recursive:true});
  for(const width of [320,390,1440]){
   await page.setViewportSize({width,height:950});await page.goto(diaryUrl(page)+"/diary/add?date=2026-10-13&slot=Breakfast");await pw(page.getByRole("button",{name:"Scegli "+food.name,exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.screenshot({path:dir+`/search-${width}.png`,fullPage:true});
   await page.getByRole("button",{name:"Scegli "+food.name,exact:true}).click();await page.getByLabel("Quantità di porzioni").fill("1,5");expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.screenshot({path:dir+`/detail-${width}.png`,fullPage:true});await page.getByRole("button",{name:"Modifica alimento e porzioni"}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.screenshot({path:dir+`/portions-${width}.png`,fullPage:true});await page.getByRole("button",{name:"Torna alla selezione"}).click();await page.getByRole("tab",{name:"Scansione",exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.screenshot({path:dir+`/scanner-${width}.png`,fullPage:true});
   aiReady=false;await page.getByRole("tab",{name:"Etichetta AI",exact:true}).click();await pw(page.locator(".ai-service-status")).toHaveText("AI disattivata");await pw(page.getByRole("button",{name:"Fotografa o carica",exact:true})).toBeDisabled();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.screenshot({path:dir+`/label-off-${width}.png`,fullPage:true});
   aiReady=true;await page.getByRole("tab",{name:"Ricerca",exact:true}).click();await page.getByRole("tab",{name:"Etichetta AI",exact:true}).click();await pw(page.locator(".ai-service-status")).toHaveText("AI attiva");expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);expect(await page.getByRole("button",{name:"Fotografa o carica",exact:true}).evaluate(button=>{const frame=button.closest(".camera-stage")!.getBoundingClientRect();const rect=button.getBoundingClientRect();return rect.top>=frame.top&&rect.bottom<=frame.bottom;})).toBe(true);await page.screenshot({path:dir+`/label-on-${width}.png`,fullPage:true});
  }
 });
},90_000);
