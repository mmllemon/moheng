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
console.log('=== 纹理相关控件 ===');
const info=await p.evaluate(()=>{
  const out={ranges:[],paperBtns:[]};
  for(const r of document.querySelectorAll('input[type=range]')){
    const cs=getComputedStyle(r);
    out.ranges.push({dis:r.disabled,opacity:cs.opacity,val:r.value,label:r.getAttribute('aria-label')||''});
  }
  for(const b of document.querySelectorAll('button')){
    const t=(b.textContent||'').trim();
    if(/关|无|纹理|纸/.test(t)&&t.length<12) out.paperBtns.push(t);
  }
  return out;
});
console.log(JSON.stringify(info,null,1));
await b.close();
