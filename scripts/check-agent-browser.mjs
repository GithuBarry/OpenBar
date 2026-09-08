import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.OB_PLAYWRIGHT_MODULE || 'playwright')
;(async()=>{
 const results=[]
 for(const native of [false,true]) {
  const b=await chromium.launch({executablePath:process.env.OB_CHROME_PATH,headless:true,args:native?['--enable-features=WebMCP','--enable-blink-features=WebMCP,WebMCPTesting']:[]})
  try {
   const p=await b.newPage()
   const errors=[]
   p.on('pageerror',e=>errors.push(e.message))
   await p.goto(`${process.env.OPENBARRY_URL || 'http://127.0.0.1:3000'}/p/${process.env.OB_SMOKE_SLUG || 'private-project-a'}/mindmap`)
   await p.waitForFunction(()=>window.openbarAgent?.listTools().some(t=>t.name==='get_mindmap'))
   const result={native,tools:await p.evaluate(()=>window.openbarAgent.listTools().length),reads:[],navigation:[],errors}
   for(const name of ['get_project_state','get_mindmap']) {
    const r=await p.evaluate(async ({native,name})=>native ? await (async () => { const context = document.modelContext || navigator.modelContextTesting; const tool = context.getTools ? (await context.getTools()).find(t => t.name === name) : name; const raw = await context.executeTool(tool, '{}'); return typeof raw === 'string' ? JSON.parse(raw) : raw })() : await window.openbarAgent.executeTool(name,{}),{native,name})
    if(!r.ok) throw Error(JSON.stringify(r))
    result.reads.push({name,ok:r.ok})
   }
   for(const page of ['paper','instructions','wiki','mindmap']) {
    const href=`/p/${process.env.OB_SMOKE_SLUG || 'private-project-a'}/${page}`
    const nav=await p.evaluate(href=>window.openbarAgent.executeTool('navigate_project',{href}),href)
    if(!nav.ok)throw Error(JSON.stringify(nav))
    const ready=await p.evaluate(href=>window.openbarAgent.waitForNavigation(href),href)
    result.navigation.push({page,...ready})
   }
   results.push(result)
  } finally {await b.close()}
 }
 console.log(JSON.stringify(results,null,2))
})().catch(e=>{console.error(e);process.exit(1)})
