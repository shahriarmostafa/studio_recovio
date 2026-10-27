import {readConfig} from '../src/config.js';
import {createPool} from '../src/db.js';
import {migrate} from '../src/migrate.js';
const config=readConfig(),pool=createPool(config);
try{await migrate(pool,config.schema);console.log(`Migrations applied in ${config.schema}.`);}
catch(error){console.error(error instanceof Error?error.message:'Migration failed');process.exitCode=1;}
finally{await pool.end();}
