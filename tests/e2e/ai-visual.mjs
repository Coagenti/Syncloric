import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
async function main() {
  const cssDir=path.join(repo,'.next/static/css'); const css=fs.readdirSync(cssDir).filter(p=>p.endsWith('.css')).map(p=>fs.readFileSync(path.join(cssDir,p),'utf8')).join('\n');
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {BarcodeEntry} from './src/components/barcode-entry';import {SettingsAiCard} from './src/components/settings/settings-ai-card';createRoot(document.getElementById('root')).render(location.pathname==='/settings'?<main style={{padding:20}}><SettingsAiCard/></main>:<BarcodeEntry date="2026-10-01" onSaved={()=>{}}/>);`,resolveDir:repo,loader:'tsx'},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
  const server=createServer(async(request,response)=>{
    if(request.url==='/app.js'){response.setHeader('content-type','application/javascript');response.end(bundle.outputFiles[0].text);return;}
    if(request.url==='/app.css'){response.setHeader('content-type','text/css');response.end(css);return;}
    if(request.url.startsWith('/api/')){
      response.setHeader('content-type','application/json');
      if(request.url==='/api/v1/settings/ai')response.end(JSON.stringify({enabled:true,provider:'openai',ready:true,keys:{openai:true,anthropic:false,ollama:true}}));
      else if(request.url==='/api/v1/label-scan'&&request.method==='GET')response.end(JSON.stringify({ready:true,enabled:true,provider:'openai',cloud:true}));
      else if(request.url==='/api/v1/label-scan')response.end(JSON.stringify({label:{name:'Snack esempio AI',brand:'Fixture',per100g:{kcal:400,fat:12,carbs:60,protein:8},servingSize:30}}));
      else response.end(JSON.stringify({origin:'unknown',food:null})); return;
    }
    response.end('<html lang="it"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>');
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  const base=`http://127.0.0.1:${server.address().port}`;const metrics=[];
  try{
    browser=await chromium.launch({args:['--no-sandbox']});const out=process.env.AI_VISUAL_OUTPUT || path.join(repo,'test-results/ai-visual');fs.mkdirSync(out,{recursive:true});
    const sample=await browser.newPage({viewport:{width:500,height:300}});
    await sample.setContent('<body style="background:white;color:black;font:20px Arial;padding:20px"><h2>ETICHETTA DIMOSTRATIVA</h2><p>Per 100 g: 400 kcal</p><p>Grassi 12 g · Carboidrati 60 g</p><p>Proteine 8 g · Porzione 30 g</p><small>Fixture sintetica per test, non foto reale.</small></body>');
    const photo=await sample.screenshot();await sample.close();
    for(const width of [320,390,1440]){
      const page=await browser.newPage({viewport:{width,height:844}});
      await page.goto(base+'/settings');await page.getByLabel('Provider AI').waitFor();
      await page.screenshot({path:path.join(out,`ai-settings-${width}.png`),fullPage:true});
      const admin=await page.getByLabel('Provider AI').boundingBox();
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
      metrics.push({width,adminSelectHeight:admin.height,adminOverflow:overflow});
      await page.goto(base);await page.getByRole('button',{name:'Scansiona',exact:true}).click();
      await page.getByLabel('Codice a barre',{exact:true}).fill('8001234567890');await page.getByRole('button',{name:'Cerca prodotto'}).click();
      await page.getByLabel('Foto etichetta').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:photo});
      await page.getByRole('img',{name:'Anteprima etichetta'}).waitFor();
      await page.screenshot({path:path.join(out,`ai-label-preview-${width}.png`)});
      await page.getByRole('button',{name:'Scansiona etichetta',exact:true}).click();await page.getByText(/Valori proposti da AI/).waitFor();
      await page.getByLabel('Nome prodotto').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(out,`ai-label-filled-${width}.png`)});
      await page.getByRole('button',{name:'Registra nel diario'}).scrollIntoViewIfNeeded();
      const confirmation=page.getByRole('checkbox',{name:'Ho verificato i valori proposti dall’AI'});
      if(await confirmation.isChecked() || !await page.getByRole('button',{name:'Registra nel diario'}).isDisabled()) throw new Error('AI confirmation missing or bypassed');
      const toggle=await confirmation.boundingBox();
      if(toggle.width<24 || toggle.width>30 || toggle.height<24 || toggle.height>30) throw new Error('Checkbox dimensions invalid');
      await page.screenshot({path:path.join(out,`ai-label-bottom-${width}.png`)});
      await confirmation.check();
      if(!await page.getByRole('button',{name:'Registra nel diario'}).isEnabled()) throw new Error('Confirmed save not enabled');
      metrics.push({width,confirmation:{uncheckedByDefault:true,saveBlocked:true,saveAfterCheck:true,toggle}});
      await page.screenshot({path:path.join(out,`ai-label-confirmed-${width}.png`)});
      const layout=await page.locator('dialog').evaluate(el=>({overflow:el.scrollWidth>el.clientWidth,centerX:el.getBoundingClientRect().x+el.getBoundingClientRect().width/2,viewport:innerWidth}));metrics.push({width,label:layout});
      await page.keyboard.press('Escape');if(!await page.getByRole('button',{name:'Scansiona',exact:true}).evaluate(el=>document.activeElement===el))throw new Error('focus not restored');
      await page.close();
    }
    fs.writeFileSync(path.join(out,'visual-metrics.json'),JSON.stringify(metrics,null,2));console.log(JSON.stringify(metrics));
    if(metrics.some(m=>m.adminOverflow||m.adminSelectHeight<44||m.label?.overflow))throw new Error('Visual regression: overflow or touch target below44px');
  }finally{try{await browser?.close();}finally{await new Promise(resolve=>server.close(resolve));}}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
