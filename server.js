const express=require('express');
const http=require('http');
const{WebSocketServer}=require('ws');
const{chromium}=require('playwright-core');
const app=express();
const server=http.createServer(app);
const wss=new WebSocketServer({server});
const SITE_PASSWORD='1q2w3e4r5t6y7u8i9o0p';
app.use(express.json());
app.use((req,res,next)=>{
if(req.path==='/api/auth'||req.path==='/login.html')return next();
const auth=req.headers['x-site-auth'];
if(auth===SITE_PASSWORD)return next();
if(req.path==='/'||req.path==='/index.html'){
return res.sendFile(__dirname+'/public/login.html');
}
res.status(401).json({error:'غير مصرح'});
});
app.use(express.static('public'));
app.post('/api/auth',(req,res)=>{
if(req.body.password===SITE_PASSWORD){
res.json({ok:true,token:SITE_PASSWORD});
}else{
res.status(401).json({error:'كلمة السر غلط'});
}
});
let browser=null,page=null,running=false,clients=new Set();
function broadcast(d){const m=JSON.stringify(d);clients.forEach(c=>{if(c.readyState===1)c.send(m);})}
function log(t,type='info'){broadcast({type:'log',text:t,logType:type,ts:new Date().toLocaleTimeString('ar-EG')})}
function progress(d,t){broadcast({type:'progress',done:d,total:t,pct:t?Math.round((d/t)*100):0})}
wss.on('connection',ws=>{clients.add(ws);ws.on('close',()=>clients.delete(ws));});
async function launchBrowser(){
if(browser)return;
log('جاري تشغيل المتصفح...','info');
browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
log('المتصفح جاهز ✓','success');
broadcast({type:'browser',state:'ready'});
}
async function doLogin(studentId,password){
const ctx=await browser.newContext({userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0',locale:'ja-JP'});
page=await ctx.newPage();
log('فتح صفحة تسجيل الدخول...','info');
await page.goto('https://qureo.jp/login',{waitUntil:'domcontentloaded',timeout:30000});
await page.waitForSelector('input',{timeout:10000});
const inputs=await page.$$('input:not([type="hidden"])');
let filled=0;
for(const inp of inputs){
const type=await inp.getAttribute('type');
const name=(await inp.getAttribute('name')||'').toLowerCase();
if(type==='password'){await inp.fill(password);filled++;}
else if(type==='text'||type==='email'||!type||name.match(/user|id|login|student/)){await inp.fill(String(studentId));filled++;}
if(filled>=2)break;
}
const sub=await page.$('button[type="submit"],input[type="submit"]');
if(sub)await sub.click();else await page.keyboard.press('Enter');
await page.waitForURL(url=>!url.includes('/login'),{timeout:15000});
log('تم تسجيل الدخول بنجاح ✓','success');
return page.url();
}
async function navigateToCourse(courseId){
log('جاري فتح الكورس: '+courseId,'info');
const patterns=['https://qureo.jp/course/'+courseId,'https://qureo.jp/path/'+courseId,'https://qureo.jp/learn/'+courseId];
for(const url of patterns){
try{await page.goto(url,{waitUntil:'domcontentloaded',timeout:10000});if(!page.url().includes('/login')){log('الكورس تفتح ✓','success');return true;}}catch(e){}
}
return false;
}
async function detectLevels(){
return await page.evaluate(()=>{
const sels=['[class*="lesson"]','[class*="level"]','[class*="stage"]','[class*="chapter"]'];
for(const s of sels){const items=document.querySelectorAll(s);if(items.length>2)return items.length;}
return 10;
});
}
async function solveLevel(n,delay){
const clicked=await page.evaluate(()=>{
const sels=['[class*="complete"]','[class*="finish"]','[class*="next"]','[class*="clear"]','[class*="次へ"]','[class*="完了"]'];
for(const s of sels){const btn=document.querySelector(s);if(btn&&btn.offsetParent!==null){btn.click();return s;}}
return null;
});
if(clicked){log('✓ مستوى '+n+': تم','success');await page.waitForTimeout(delay*1000);return true;}
const next=await page.$('button:has-text("次"),button:has-text("Next"),button:has-text("続")');
if(next){await next.click();log('✓ مستوى '+n+': انتقل','success');await page.waitForTimeout(delay*1000);return true;}
log('⚠ مستوى '+n+': تخطى','warn');
return false;
}
async function runSolver({studentId,password,courseId,delay}){
running=true;
broadcast({type:'state',state:'running'});
try{
await launchBrowser();
await doLogin(studentId,password);
await page.waitForTimeout(1500);
await navigateToCourse(courseId);
await page.waitForTimeout(2000);
const total=await detectLevels();
log('تم اكتشاف '+total+' مستوى','info');
progress(0,total);
let done=0;
for(let i=1;i<=total;i++){
if(!running)break;
const ok=await solveLevel(i,delay);
if(ok)done++;
progress(done,total);
}
log('✓ انتهى — تم حل '+done+' من '+total,'success');
broadcast({type:'state',state:'done'});
}catch(err){
log('✗ خطأ: '+err.message,'error');
broadcast({type:'state',state:'error'});
}finally{running=false;}
}
app.post('/api/start',async(req,res)=>{
if(running)return res.status(409).json({error:'شغالة'});
const{studentId,password,courseId,delay}=req.body;
if(!studentId||!password||!courseId)return res.status(400).json({error:'بيانات ناقصة'});
runSolver({studentId,password,courseId,delay:delay||3});
res.json({ok:true});
});
app.post('/api/stop',(req,res)=>{
running=false;
broadcast({type:'state',state:'stopped'});
res.json({ok:true});
});
const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log('port '+PORT));
