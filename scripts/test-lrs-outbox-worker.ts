import { SyntheticLrsOutbox } from '../lib/experiments/lrs-synthetic-outbox';
const repo=new SyntheticLrsOutbox(process.argv[2]);
try {console.log(JSON.stringify(repo.reserve(Number(process.argv[3]),30000)));}finally{repo.close();}
