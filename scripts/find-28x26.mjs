import { chromium } from 'playwright-core';
const ROUTES=['/','/projects','/projects/members','/cost/contracts','/cost/budget','/cost/progress-bills','/cost/changes','/cost/downstream','/cost/owner-finance','/cost/costs','/cost/analysis','/reports','/reports/designer','/reports/studio','/notifications','/parties','/audit-logs','/settings/appearance','/system','/system/security','/system/authorization','/system/policies','/system/governance','/system/operations','/system/dictionaries','/system/parameters','/system/accounts','/system/assistant','/account/security'];
const b=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const c=await b.newContext({viewport:{width:1440,height:900},locale:'zh-CN'});
const p=await c.newPage();
await p.goto('http://localhost:5173/login',{waitUntil:'networkidle'});
await p.locator('input[type=email]').first().fill('admin@local.test');
await p.locator('input[type=password]').first().fill('ChangeMe123!');
await p.locator('button[type=submit]').first().click();
await p.waitForTimeout(2600);
for(const R of ROUTES){
  await p.evaluate(r=>{history.pushState(null,'',r);dispatchEvent(new PopStateEvent('popstate'))},R);
  await p.waitForTimeout(820);
  const o=await p.evaluate(()=>{
    const a=[];
    for(const el of document.querySelectorAll('button,[role=button],a')){
      const cs=getComputedStyle(el); if(cs.display==='none')continue;
      const b=el.getBoundingClientRect();
      if(Math.round(b.height)!==26||Math.round(b.width)!==28)continue;
      a.push({cls:(el.className||'').toString().slice(0,44),aria:el.getAttribute('aria-label')||''});
    }
    return a;
  });
  if(o.length)console.log(R, o.length, JSON.stringify(o.slice(0,2)));
}
await b.close();
