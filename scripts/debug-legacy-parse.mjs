import { chromium } from 'playwright-core';
const b=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const ctx=await b.newContext({viewport:{width:1440,height:900},locale:'zh-CN'});
const p=await ctx.newPage();
const msgs=[];
p.on('console',m=>{if(m.type()==='error'||m.type()==='warning')msgs.push(m.text().slice(0,200))});
await p.goto('http://localhost:5173/login',{waitUntil:'networkidle'});
await p.waitForTimeout(2500);
const r=await p.evaluate(()=>{
  const out=[];
  for(const sheet of document.styleSheets){
    const id=(sheet.ownerNode&&sheet.ownerNode.getAttribute&&sheet.ownerNode.getAttribute('data-vite-dev-id'))||'';
    if(!/legacy\.css/.test(id))continue;
    const rules=sheet.cssRules;
    out.push({id,rulesLen:rules.length});
    for(let i=0;i<Math.min(3,rules.length);i++){
      const rule=rules[i];
      out.push({i,type:rule.type,hasCssRules:!!rule.cssRules,ctor:rule.constructor.name,cssText:(rule.cssText||'').slice(0,120)});
    }
  }
  return out;
});
console.log(JSON.stringify(r,null,1));
console.log('\n=== 控制台错误/警告 ===');
console.log(msgs.slice(0,8).join('\n')||'(无)');
await b.close();
