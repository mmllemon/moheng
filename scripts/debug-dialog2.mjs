import { chromium } from 'playwright-core';
const b=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const c=await b.newContext({viewport:{width:1440,height:900},locale:'zh-CN'});
const p=await c.newPage();
await p.goto('http://localhost:5173/login',{waitUntil:'networkidle'});
await p.locator('input[type=email]').first().fill('admin@local.test');
await p.locator('input[type=password]').first().fill('ChangeMe123!');
await p.locator('button[type=submit]').first().click();
await p.waitForTimeout(2600);
await p.evaluate(()=>{history.pushState(null,'','/cost/changes');dispatchEvent(new PopStateEvent('popstate'))});
await p.waitForTimeout(1400);
await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(e=>(e.textContent||'').trim()==='内部审批');if(b)b.click()});
await p.waitForTimeout(1200);
const r = await p.evaluate(()=>{
  const d=document.querySelector('.dialog');
  if(!d) return {noDialog:true};
  const inputs=[...d.querySelectorAll('input,textarea')];
  return {cls:d.className, inputs: inputs.map(e=>{
    const cs=getComputedStyle(e);
    return {type:e.type||e.tagName.toLowerCase(),ro:e.readOnly,dis:e.disabled,opacity:cs.opacity,bg:cs.backgroundColor,border:cs.borderTopColor,cursor:cs.cursor,ph:e.placeholder||''};
  })};
});
console.log(JSON.stringify(r,null,1));
await b.close();
