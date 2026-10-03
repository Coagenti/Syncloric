import { it, expect } from "vitest";
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "@/server/db";
import { buildAiHandlers } from "@/server/services/ai/http";
it("AI admin settings: explicit provider, presence only, save persistence and disable", async () => {
  const client = new PGlite(); const db = drizzle(client) as unknown as Db;
  await migrate(db as never,{migrationsFolder:"./drizzle"});
  const handlers = buildAiHandlers({getDb:()=>db,getSession:async()=>({user:{id:"11111111-1111-4111-8111-111111111111",role:"admin"}}),env:()=>({OPENAI_API_KEY:"test-secret-not-visible"})});
  const bundle = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {SettingsAiCard} from './src/components/settings/settings-ai-card';createRoot(document.getElementById('root')).render(<SettingsAiCard/>);`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,platform:"browser",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'}});
  const server = createServer(async(req,res)=>{
    if(req.url==="/app.js"){res.setHeader("Content-Type","application/javascript");res.end(bundle.outputFiles[0].text);return;}
    if(req.url==="/api/v1/settings/ai"){
      const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
      const request=new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers as Record<string,string>,...(req.method==="PUT"?{body:Buffer.concat(chunks).toString()}: {})});
      const response=await handlers[req.method==="PUT"?"PUT":"GET"](request);res.writeHead(response.status,{"Content-Type":"application/json"});res.end(await response.text());return;
    }
    res.end('<html lang="it"><meta name="viewport" content="width=device-width"><div id="root"></div><script src="/app.js"></script></html>');
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));const browser=await chromium.launch({args:["--no-sandbox"]});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}`);
    await page.getByLabel("Provider AI").waitFor();expect(await page.getByLabel("Provider AI").inputValue()).toBe("");
    await page.getByLabel("Provider AI").selectOption("openai");await page.getByText("Chiave configurata in ambiente").waitFor();
    await page.getByLabel("Abilita scansione AI").check();await page.getByRole("button",{name:"Salva AI"}).click();await page.getByText("Impostazioni AI salvate.",{exact:true}).waitFor();
    expect(await page.content()).not.toContain("test-secret-not-visible");
    await page.reload();await page.getByLabel("Abilita scansione AI").waitFor();expect(await page.getByLabel("Abilita scansione AI").isChecked()).toBe(true);expect(await page.getByLabel("Provider AI").inputValue()).toBe("openai");
    await page.getByLabel("Abilita scansione AI").uncheck();await page.getByRole("button",{name:"Salva AI"}).click();await page.getByText("Impostazioni AI salvate.",{exact:true}).waitFor();
    expect((await client.query<{value:boolean}>("SELECT value FROM admin_settings WHERE key='ai.enabled'")).rows[0].value).toBe(false);
  }finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await client.close();}
},600000);
