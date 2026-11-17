import { DatabaseSync } from 'node:sqlite';
import { sanitizedAudioPath } from '../server/media.mjs';
import fs from 'node:fs';
const db = new DatabaseSync('/opt/radiotv/server/radiotv.sqlite', { readOnly: true });
const worker = Number(process.argv[2] || 0);
const rows = db.prepare('SELECT id,filepath FROM sets ORDER BY seq_num').all().filter((_, i) => i % 3 === worker);
const results=[];
for(const row of rows){
 try { const clean=await sanitizedAudioPath(row.filepath);results.push({id:row.id,ok:true,bytes:fs.statSync(clean).size}); }
 catch(error){results.push({id:row.id,ok:false,error:error.message});}
 fs.writeFileSync(`evidence/audio-preparation-${worker}.json`,JSON.stringify(results));
 if(results.length%20===0||results.length===rows.length) console.log(`Prepared ${results.length}/${rows.length}; failed ${results.filter(x=>!x.ok).length}`);
}
if(results.some(x=>!x.ok))process.exitCode=1;
