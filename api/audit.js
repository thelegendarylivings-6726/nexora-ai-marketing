export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'POST required'});
 let raw=String(req.body?.url||'').trim();if(!raw)return res.status(400).json({error:'Website URL required'});
 if(!/^https?:\/\//i.test(raw))raw='https://'+raw;
 let u;try{u=new URL(raw)}catch{return res.status(400).json({error:'Invalid URL'})}
 if(!['http:','https:'].includes(u.protocol))return res.status(400).json({error:'Unsupported URL'});
 const host=u.hostname.toLowerCase();
 if(host==='localhost'||host.endsWith('.local')||/^127\.|^10\.|^192\.168\.|^169\.254\./.test(host))return res.status(400).json({error:'Private addresses are not supported'});
 try{
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8000);const started=Date.now();
  const r=await fetch(u.toString(),{redirect:'follow',signal:controller.signal,headers:{'user-agent':'NexoraWebsiteAudit/1.0'}});
  clearTimeout(timer);const ms=Date.now()-started;const html=(await r.text()).slice(0,1000000);
  const has=(re)=>re.test(html), title=(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]?.replace(/<[^>]+>/g,'').trim()||'';
  const desc=(html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)||html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)||[])[1]||'';
  const checks=[
   {name:'HTTPS',ok:r.url.startsWith('https://'),points:15,tip:'Use HTTPS across the whole website.'},
   {name:'Mobile viewport',ok:has(/<meta[^>]+name=["']viewport["']/i),points:10,tip:'Add a responsive mobile viewport.'},
   {name:'SEO title',ok:title.length>=20&&title.length<=65,points:15,tip:'Use a clear 20–65 character SEO title.'},
   {name:'Meta description',ok:desc.length>=70&&desc.length<=180,points:10,tip:'Add a useful 70–180 character meta description.'},
   {name:'Primary heading',ok:has(/<h1[\s>]/i),points:10,tip:'Add one clear H1 describing the main offer.'},
   {name:'Conversion CTA',ok:has(/>([^<]{0,35})(contact|book|buy|start|get|quote|demo|call|shop|subscribe|sign up)([^<]{0,35})</i),points:15,tip:'Make the main customer action obvious.'},
   {name:'Contact path',ok:has(/mailto:|tel:|contact/i),points:10,tip:'Add an easy contact or enquiry path.'},
   {name:'Social sharing',ok:has(/property=["']og:title|name=["']twitter:card/i),points:5,tip:'Add Open Graph/social sharing metadata.'},
   {name:'Fast response',ok:ms<2000,points:10,tip:'Improve server/page response speed.'}
  ];
  const score=checks.reduce((n,c)=>n+(c.ok?c.points:0),0);const issues=checks.filter(c=>!c.ok).map(c=>c.tip).slice(0,5);
  return res.status(200).json({url:r.url,status:r.status,responseMs:ms,score,title,description:desc,checks,issues});
 }catch(e){return res.status(422).json({error:'Could not audit this website. It may block automated checks or be temporarily unavailable.'})}
}