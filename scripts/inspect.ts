import {readConfig} from '../src/config.js';
import {createPool} from '../src/db.js';
const pool=createPool(readConfig());
try{
  const result=await pool.query("SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1,2");
  console.log('Database connected with verified TLS. Existing tables:',result.rows);
}catch{console.error('Database inspection failed. Check connectivity and DATABASE_URL locally.');process.exitCode=1;}finally{await pool.end();}
