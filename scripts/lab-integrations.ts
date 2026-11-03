/** Manual, development-only probes against local test services. No player data. */
import { readSyntheticPocketBaseCatalog, sendSyntheticLrsProbe, sendSyntheticUmamiProbe } from '../lib/experiments/local-connectors';
import { syntheticFsrsComparison } from '../lib/experiments/fsrs-demo';
async function main() {
 const mode=process.argv[2];
 if(mode==='fsrs') { console.table(syntheticFsrsComparison()); return; }
 const base=process.env.GIB_LAB_BASE;
 if(!base) throw Error('Set GIB_LAB_BASE to an HTTP loopback URL with port');
 if(mode==='pocketbase') {console.log(await readSyntheticPocketBaseCatalog(base));return;}
 if(mode==='lrs') {await sendSyntheticLrsProbe(base,process.env.GIB_LAB_LRS_KEY??'',process.env.GIB_LAB_LRS_SECRET??'');console.log('Synthetic statement accepted');return;}
 if(mode==='umami') {await sendSyntheticUmamiProbe(base,process.env.GIB_LAB_UMAMI_SITE??'');console.log('Synthetic event accepted');return;}
 throw Error('Expected fsrs, pocketbase, lrs or umami');
}
main().catch((e:unknown)=>{console.error(e instanceof Error?e.message:'Laboratory probe failed');process.exitCode=1});
