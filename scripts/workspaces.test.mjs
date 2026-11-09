import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes, scryptSync } from 'node:crypto'
import { createProductionServer } from '../server/production.js'
import { registerApiRoutes } from '../server/assistant-plugin.js'

async function app(t) {
 const root=await mkdtemp(path.join(tmpdir(),'salescope-workspaces-')),salt=randomBytes(16).toString('hex'),hash=`scrypt:${salt}:${scryptSync('test-password',salt,32).toString('hex')}`
 const routes=[];registerApiRoutes({use:(prefix,handler)=>routes.push({prefix,handler})},{modelCall:async messages=>{
  if(messages[0].content.includes('数据准备助手'))return JSON.stringify({headerStart:2,headerDepth:1,excludeRows:[5],reason:'先确认表头和合计行'})
  if(messages.at(-1).content.startsWith('Observation'))return JSON.stringify({action:'finish',result_id:'result-1'})
  return JSON.stringify({action:'query_workspace',plan:{group_by:[],measures:[{column:'金额',aggregate:'sum',alias:'金额合计'}],filters:[],order:null,limit:null}})
 }})
 const server=createProductionServer({users:{alice:hash,bob:hash},dataRoot:root,routes});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true})})
 const request=(route,body,user='alice')=>fetch(origin+route,{method:body?'POST':'GET',headers:{Authorization:'Basic '+Buffer.from(user+':test-password').toString('base64'),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined})
 return {origin,request}
}

test('V3 versions preserve original positions, block invalid confirmation, isolate accounts and support historical continued analysis',async t=>{
 const a=await app(t)
 const inspected=await(await a.request('/api/workspaces/inspect',{name:'复杂.csv',data:Buffer.from('业务报表\n客户,金额\n甲,100\n乙,200\n合计,300').toString('base64')})).json()
 assert.ok(inspected.uploadId);assert.equal(inspected.sheets.length,1)
 assert.equal((await a.request('/api/workspaces/prepare',{uploadId:inspected.uploadId,sheet:'CSV',plan:{headerStart:2}},'bob')).status,404)
 const suggestion=await(await a.request('/api/workspaces/suggest',{uploadId:inspected.uploadId,sheet:'CSV'})).json();assert.deepEqual(suggestion.suggestion.excludeRows,[5])
 const preview=await(await a.request('/api/workspaces/prepare',{uploadId:inspected.uploadId,sheet:'CSV',plan:{headerStart:2,headerDepth:1,excludeRows:[5],schema:{金额:{type:'number'}}}})).json()
 assert.equal(preview.rowCount,2);assert.equal(preview.provenance[0].row,3);assert.equal(preview.quality.columns.find(c=>c.name==='金额').sum,300)
 assert.equal((await a.request('/api/workspaces/confirm',{previewId:preview.previewId,confirmed:true})).status,400)
 const committed=await(await a.request('/api/workspaces/confirm',{previewId:preview.previewId,confirmed:true,recordGrain:'一客户一条记录',name:'已确认测试表'})).json();assert.ok(committed.version.id)
 assert.equal((await a.request('/api/workspaces/versions/'+committed.version.id,undefined,'bob')).status,404)
 const response=await a.request('/api/assistant',{question:'金额合计是多少',versionId:committed.version.id,rows:[{金额:99999}],headers:['金额'],requestId:crypto.randomUUID()});const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.rows[0].value,300);assert.ok(result.historyId)
 const history=await(await a.request('/api/history/'+result.historyId)).json();assert.equal(history.dataset.versionId,committed.version.id)
 const version=await(await a.request('/api/workspaces/versions/'+history.dataset.versionId)).json();assert.equal(version.table.rows.length,2);assert.equal(version.table.rows[0].金额,100)
 const guest=await fetch(a.origin+'/api/demo/workspaces/versions');assert.equal(guest.status,403)
 const guestPrivate=await fetch(a.origin+'/api/workspaces/versions');assert.equal(guestPrivate.status,401)
})
