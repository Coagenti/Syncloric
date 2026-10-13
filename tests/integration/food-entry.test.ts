import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { Db } from "@/server/db";
import { buildFoodEntryHandlers } from "@/server/services/foods/entry-http";
import { buildDiaryCreateHandlers } from "@/server/services/diary/create";
import { buildDiaryFeedHandlers } from "@/server/services/diary/feed";
import { buildDiaryMutationHandlers } from "@/server/services/diary/mutate";
import { buildExportHandlers } from "@/server/services/export/http";
import { buildMealLinkHandlers, buildMealCopyHandlers } from "@/server/services/households/meals";
import { makeTestDb, resetTables, closeTestDb, type TestDb } from "./setup";
const A="11111111-1111-4111-8111-111111111111", B="22222222-2222-4222-8222-222222222222", F="aaaaaaaa-1111-4111-8111-111111111111";
const portions=[{id:"bbbbbbbb-1111-4111-8111-111111111111",label:"Biscotto",grams:6,defaultQuantity:4},{id:"bbbbbbbb-2222-4222-8222-222222222222",label:"Pacchetto",grams:50,defaultQuantity:1}];
const product={name:"Biscotti",brand:"Marca",kcalPer100g:450,nutrientsPer100g:{protein:8,carbs:60,fat:20},portions,date:"2026-10-13",slot:"Breakfast",quantityGrams:9,portion:{label:"Biscotto",grams:6,quantity:1.5}};
const request=(path:string,body?:unknown,origin="http://localhost")=>new Request(`http://localhost/api/v1/foods${path}`,{method:body===undefined?"GET":"POST",headers:{"Content-Type":"application/json",Origin:origin},...(body!==undefined?{body:JSON.stringify(body)}:{})});
describe("food entry and personal portions",()=>{
 let db:TestDb;beforeAll(async()=>{db=await makeTestDb();});afterAll(closeTestDb);
 beforeEach(async()=>{await resetTables(db);await db.execute(sql`INSERT INTO users(id,username) VALUES(${A}::uuid,'a'),(${B}::uuid,'b')`);await db.execute(sql`INSERT INTO foods(id,name,brand,kcal_per_100g,created_by) VALUES(${F}::uuid,'Pasta','Barilla',350,${A}::uuid)`);});
 const deps=(id:string|null=A)=>({getDb:()=>db as unknown as Db,getSession:async()=>id?{user:{id}}:null});
 const handlers=(id:string|null=A)=>buildFoodEntryHandlers({...deps(id),lookup:async()=>null,search:async()=>({foods:[],hasMore:false})});
 it("atomically creates an ingredient, multiple defaults and fractional portion snapshot",async()=>{
   const response=await handlers().POST(request("",product));expect(response.status).toBe(201);const {entry,food}=await response.json();expect(food.portions).toEqual(portions);
   const row=(await db.execute(sql`SELECT * FROM diary_entries WHERE id=${entry.id}::uuid`)).rows[0];expect(row).toMatchObject({user_id:A,quantity_grams:"9.00",portion_grams:"6.00",portion_quantity:"1.50",portion_label:"Biscotto",kcal:41,protein:"0.72"});
   const feed=await buildDiaryFeedHandlers(deps()).GET(new Request('http://localhost/api/v1/diary?month=2026-10'));expect((await feed.json()).entries[0].portion).toEqual(product.portion);
 });
 it("keeps portion preferences per user and leaves recorded weights intact",async()=>{
   const {food}=await(await handlers().POST(request("",product))).json();
   const patch=(user:string,values:unknown)=>handlers(user).PATCH(new Request(`http://localhost/api/v1/foods/${food.id}`,{method:"PATCH",headers:{"Content-Type":"application/json",Origin:"http://localhost"},body:JSON.stringify({portions:values})}),food.id);
   expect((await patch(B,[{...portions[0],grams:10}])).status).toBe(200);
   expect((await(await handlers(B).GET(request('/'+food.id),food.id)).json()).food.portions[0].grams).toBe(10);
   expect((await(await handlers(A).GET(request('/'+food.id),food.id)).json()).food.portions[0].grams).toBe(6);
   expect((await patch(A,[{...portions[0],grams:7}])).status).toBe(200);
   expect((await db.execute(sql`SELECT portion_grams,quantity_grams FROM diary_entries`)).rows[0]).toMatchObject({portion_grams:"6.00",quantity_grams:"9.00"});
 });
 it("ranks habits independently for each user and meal, excluding deleted Norish rows",async()=>{
   const {food}=await(await handlers().POST(request("",product))).json(); const create=(user:string,slot:string,id:string)=>buildDiaryCreateHandlers(deps(user)).POST(new Request('http://localhost/api/v1/diary',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost'},body:JSON.stringify({entryType:'food',foodId:id,date:product.date,slot,quantityGrams:100})}));
   await create(A,'Breakfast',food.id);await create(A,'Lunch',F);await create(B,'Breakfast',F);
   await db.execute(sql`INSERT INTO diary_entries(user_id,date,slot,entry_type,food_id,quantity_grams,source,norish_deleted) VALUES(${A}::uuid,'2026-10-13','Breakfast','food',${F}::uuid,100,'norish_sync',true)`);
   expect((await(await handlers().FREQUENT(request('/frequent?slot=Breakfast'))).json()).foods.map((v:{id:string;uses:number})=>[v.id,v.uses])).toEqual([[food.id,2]]);
   expect((await(await handlers().FREQUENT(request('/frequent?slot=Lunch'))).json()).foods[0].id).toBe(F);
   expect((await(await handlers(B).FREQUENT(request('/frequent?slot=Breakfast'))).json()).foods[0].id).toBe(F);
 });
 it("updates quantity/energy for recorded portions and clears stale portion metadata on gram edits",async()=>{
   const {entry}=await(await handlers().POST(request('',product))).json();const mutate=buildDiaryMutationHandlers(deps());
   const patch=(body:unknown)=>mutate.PATCH(new Request('http://localhost/api/v1/diary/'+entry.id,{method:'PATCH',headers:{'Content-Type':'application/json',Origin:'http://localhost'},body:JSON.stringify(body)}),{params:Promise.resolve({id:entry.id})});
   let response=await patch({quantityGrams:12,kcal:55,nutrients:{},portion:{label:'Biscotto',grams:6,quantity:2}});expect(response.status).toBe(200);expect((await response.json()).entry).toMatchObject({kcal:54,protein:'0.96',portionQuantity:'2.00'});
   response=await patch({quantityGrams:20});expect((await response.json()).entry).toMatchObject({portionLabel:null,portionGrams:null,portionQuantity:null});
 });
 it("enforces ingredient ownership while allowing personal portion definitions",async()=>{
   const response=await handlers(B).PATCH(new Request('http://localhost/api/v1/foods/'+F,{method:'PATCH',headers:{'Content-Type':'application/json',Origin:'http://localhost'},body:JSON.stringify({portions,product:{name:'Changed',brand:null,kcalPer100g:10,nutrientsPer100g:{}}})}),F);expect(response.status).toBe(403);
   expect((await(await handlers().GET(request('/'+F),F)).json()).food.name).toBe('Pasta');
 });
 it.each([{...product,quantityGrams:10},{...product,portions:[portions[0],portions[0]]},{...product,quantityGrams:0},{...product,portion:{...product.portion,grams:0}}])("rejects inconsistent/invalid quantities without catalog writes",async body=>{expect((await handlers().POST(request('',body))).status).toBe(400);expect((await db.execute(sql`SELECT count(*)::int AS n FROM foods`)).rows[0].n).toBe(1);});
 it("rolls back ingredient and preference writes if diary insertion fails",async()=>{
   await db.execute(sql`ALTER TABLE diary_entries ADD CONSTRAINT reject_test CHECK (kcal <> 41)`);try{expect((await handlers().POST(request('',product))).status).toBe(500);expect((await db.execute(sql`SELECT count(*)::int AS n FROM foods`)).rows[0].n).toBe(1);expect((await db.execute(sql`SELECT count(*)::int AS n FROM food_preferences`)).rows[0].n).toBe(0);}finally{await db.execute(sql`ALTER TABLE diary_entries DROP CONSTRAINT reject_test`);}
 });
 it("reuses existing barcodes and server nutrition without overwriting another catalog food",async()=>{
   const first=await handlers().POST(request('',{...product,barcode:'8001234567890'}));const id=(await first.json()).food.id;
   const second=await handlers(B).POST(request('',{...product,barcode:'8001234567890',name:'Spoofed',kcalPer100g:0}));expect(second.status).toBe(201);const body=await second.json();expect(body.food.id).toBe(id);expect(body.food.name).toBe('Biscotti');expect((await db.execute(sql`SELECT kcal FROM diary_entries WHERE id=${body.entry.id}::uuid`)).rows[0].kcal).toBe(41);
 });
 it("authenticates before processing input and denies banned sessions and cross-origin writes",async()=>{
   expect((await handlers(null).POST(request('',product))).status).toBe(401);expect((await handlers().POST(request('',product,'https://other.test'))).status).toBe(403);
   await db.execute(sql`UPDATE users SET banned=true WHERE id=${A}::uuid`);expect((await handlers().FREQUENT(request('/frequent?slot=Lunch'))).status).toBe(401);
 });
 it("exports personal definitions and recorded portion snapshots without leaking other preferences",async()=>{
   const {food}=await(await handlers().POST(request('',product))).json();
   await handlers(B).PATCH(new Request('http://localhost/api/v1/foods/'+food.id,{method:'PATCH',headers:{'Content-Type':'application/json',Origin:'http://localhost'},body:JSON.stringify({portions:[{...portions[0],grams:10}]})}),food.id);
   const exportA=await(await buildExportHandlers(deps()).GET(new Request('http://localhost/api/v1/export?format=json'))).json();expect(exportA.foodPreferences[0].portions).toEqual(portions);expect(exportA.entries[0]).toMatchObject({portionLabel:'Biscotto',portionGrams:6,portionQuantity:1.5});
   const exportB=await(await buildExportHandlers(deps(B)).GET(new Request('http://localhost/api/v1/export?format=json'))).json();expect(exportB.foodPreferences[0].portions[0].grams).toBe(10);expect(exportB.entries).toEqual([]);
   const csv=await(await buildExportHandlers(deps()).GET(new Request('http://localhost/api/v1/export?format=csv'))).text();expect(csv).toContain('"portionLabel","portionGrams","portionQuantity"');expect(csv).toContain('"Biscotto","6","1.5"');
 });
 it("copies shared portions as independent snapshots even with different recipient defaults",async()=>{
   await handlers().POST(request('',product));
   const link=await buildMealLinkHandlers(deps()).POST(new Request('http://localhost/api/v1/meals/links',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost'},body:JSON.stringify({date:product.date,slot:product.slot})}));const {path}=await link.json();
   const response=await buildMealCopyHandlers(deps(B)).POST(new Request('http://localhost/api/v1/meals/copy',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost'},body:JSON.stringify({via:'link',token:path.split('#')[1],targetDate:product.date,targetSlot:'Snack'})}));expect(response.status).toBe(201);
   const row=(await db.execute(sql`SELECT * FROM diary_entries WHERE user_id=${B}::uuid`)).rows[0];expect(row).toMatchObject({food_id:null,copied_meal:true,portion_label:'Biscotto',portion_grams:'6.00',portion_quantity:'1.50',quantity_grams:'9.00'});
 });
});
