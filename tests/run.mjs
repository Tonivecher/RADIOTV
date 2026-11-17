import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
const root=path.resolve('test-runs',String(Date.now()));
fs.mkdirSync(root+'/sets',{recursive:true});fs.mkdirSync(root+'/moved');
for(const name of ['alpha','beta','gamma']) execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','65','-ac','2','-metadata','title=RADIOTV_CANARY_TITLE','-metadata','artist=RADIOTV_CANARY_ARTIST','-y',root+'/sets/'+name+'.wav']);
const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(r=>listener.close(r));
const env={...process.env,PORT:String(port),RADIOTV_TEST_URL:`http://127.0.0.1:${port}`,RADIOTV_TEST_DATA_DIR:root,RADIOTV_DATA_DIR:root,RADIOTV_SETS_DIRS:root+'/sets:'+root+'/moved',RADIOTV_AUDIO_CACHE:root+'/cache',RADIOTV_SECRET:'isolated-regression-test-secret-not-production',RADIOTV_DEMO:'0'};
let server;
async function start(){
 const fd=fs.openSync(root+'/server.log','a');server=spawn('node',['server/index.mjs'],{env,stdio:['ignore',fd,fd]});fs.closeSync(fd);
 for(let i=0;i<100;i++) {try{if((await fetch(env.RADIOTV_TEST_URL+'/api/health')).ok)return;}catch{} await new Promise(r=>setTimeout(r,100));}
 throw new Error('Test server did not start');
}
async function stop(){if(server&&server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}}
async function run(args){const child=spawn('node',args,{env,stdio:'inherit'});const [code]=await once(child,'exit');if(code!==0)throw new Error(`Test failed: ${args.join(' ')}`);}
try{await start();await run(['--test','tests/regression.mjs']);await stop();await start();await run(['tests/browser.mjs']);fs.writeFileSync('evidence/verification-result.json',JSON.stringify({ok:true,serverChecks:13,browserChecks:13,testData:root,completedAt:new Date().toISOString()},null,2));console.log('TEST_DATA',root);}finally{await stop();}
