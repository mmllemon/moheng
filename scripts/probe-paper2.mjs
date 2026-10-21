import { chromium } from 'playwright-core';
const b=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const c=await b.newContext({viewport:{width:1440,height:900},locale:'zh-CN'});
const p=await c.newPage();
await p.goto('http://localhost:5173/login',{waitUntil:'networkidle'});
await p.locator('input[type=email]').first().fill('admin@local.test');
await p.locator('input[type=password]').first().fill('ChangeMe123!');
await p.locator('button[type=submit]').first().click();
await p.waitForTimeout(2600);
await p.evaluate(()=>{history.pushState(null,'','/settings/appearance');dispatchEvent(new PopStateEvent('popstate'))});
await p.waitForTimeout(1500);
// 点“关闭”纹理
await p.evaluate(()=>{
  const btns=[...document.querySelectorAll('button')].filter(e=>(e.textContent||'').trim()==='关闭');
  if(btns[0]) btns[0].click();
});
await p.waitForTimeout(900);
const r=await p.evaluate(()=>{
  const out=[];
  for(const el of document.querySelectorAll('input[type=range]')){
    const cs=getComputedStyle(el);
    const wrap=el.closest('.settings-step-slider');
    const wcs=wrap?getComputedStyle(wrap):null;
    out.push({label:el.getAttribute('aria-label'),dis:el.disabled,opacity:cs.opacity,cursor:cs.cursor,
      wrapCls:wrap?wrap.className:'', wrapOpacity:wcs?wcs.opacity:'', wrapCursor:wcs?wcs.cursor:''});
  }
  return out;
});
console.log(JSON.stringify(r,null,1));
await b.close();
