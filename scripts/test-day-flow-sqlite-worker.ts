import { DayFlowSqlite } from '../lib/day/day-flow-sqlite';
const [file,owner,id,op,version,type]=process.argv.slice(2);
const repo=new DayFlowSqlite(file);
try {console.log(JSON.stringify(repo.advance(owner,id,op,Number(version),{type} as never)));} finally {repo.close();}
