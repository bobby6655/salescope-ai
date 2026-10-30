export const loginPage = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登录 · SaleScope AI</title>
<style>
:root{--blue:#3B6CF4;--page:#F7F8FA;--line:#DFE0E8;--ink:#1A1A2E;--body:#4B4D63}
*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:var(--page);color:var(--body);font-family:Manrope,"PingFang SC",sans-serif}
main{width:100%;max-width:420px;padding:32px;background:white;border:1px solid var(--line);border-radius:12px}header{margin-bottom:28px}.brand{color:var(--blue);font-weight:700;font-size:16px}h1{font-size:26px;color:var(--ink);margin:22px 0 10px}p{font-size:14px;line-height:1.7;margin:0}label{display:block;margin:20px 0 8px;font-size:14px;font-weight:600}
input{display:block;width:100%;min-height:46px;padding:12px;border:1px solid var(--line);border-radius:6px;font:inherit;color:var(--ink);background:white}input:focus{outline:2px solid var(--blue);outline-offset:2px}button{width:100%;min-height:46px;margin-top:26px;background:var(--blue);color:white;border:0;border-radius:6px;font:inherit;font-weight:600;cursor:pointer}button:hover{background:#1E54D4}button:focus-visible{outline:2px solid var(--blue);outline-offset:3px}button:disabled{opacity:.6;cursor:wait}.error{color:#C72B2B;min-height:24px;margin-top:14px}footer{margin-top:16px;font-size:12px;line-height:1.6;color:#696B80}
@media(max-width:480px){body{padding:16px}main{padding:24px}}
</style></head><body><main><header><div class="brand">SaleScope AI</div><h1>登录你的分析工作台</h1><p>使用已有账号登录，查看和分析你的数据。</p></header>
<form id="login-form" method="post" action="/api/auth/login"><label for="username">账号</label><input id="username" name="username" autocomplete="username" required maxlength="64" autofocus aria-label="登录账号">
<label for="password">密码</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256" aria-label="登录密码">
<button id="submit" type="submit">登录</button><p class="error" id="error" role="alert" aria-live="polite"></p></form><footer>账号由工作台管理员提供。不同账号的数据独立保存。</footer></main><script src="/auth/login.js" defer></script></body></html>`

export const loginScript = `
const form=document.getElementById('login-form');
form.addEventListener('submit',async event=>{
  event.preventDefault();const button=document.getElementById('submit');const error=document.getElementById('error');
  button.disabled=true;button.textContent='正在登录…';error.textContent='';
  try{
    const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({username:form.username.value,password:form.password.value})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'登录失败');
    form.password.value='';window.location.assign('/');
  }catch(failure){error.textContent=failure.message||'无法连接服务，请重试';}
  finally{button.disabled=false;button.textContent='登录';}
});`
