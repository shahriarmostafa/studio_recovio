import {mkdir,writeFile} from 'node:fs/promises';
import {readConfig} from '../src/config.js';
import {createPool,tables,transaction} from '../src/db.js';
import {hashPassword,temporaryPassword,audit} from '../src/security.js';
import {email,password as passwordSchema} from '../src/validation.js';
const config=readConfig(),pool=createPool(config),t=tables(config.schema);
try{
  const address=email.parse(process.env.ADMIN_EMAIL),name=process.env.ADMIN_NAME?.trim()||'Amministratore Studio';
  const initialPassword=passwordSchema.parse(process.env.ADMIN_PASSWORD||temporaryPassword());
  await mkdir('.local',{recursive:true});
  const credentialFile='.local/admin-credentials.txt';
  // Never silently reset an account or overwrite an existing credential handoff.
  await transaction(pool,async db=>{
    const user=(await db.query(`INSERT INTO ${t('users')}(email,name,role,password_hash) VALUES($1,$2,'admin',$3) RETURNING id`,[address,name,await hashPassword(initialPassword)])).rows[0];
    await audit(db,config.schema,user.id,'admin.bootstrapped',user.id);
    await writeFile(credentialFile,`Studio Recovio — local administrator\nURL: ${config.portalOrigin}/login\nEmail: ${address}\nTemporary password: ${initialPassword}\n\nChange this password at first sign-in. Delete this file after saving it securely.\n`,{flag:'wx',mode:0o600});
  });
  console.log(`Administrator created. Credentials saved to ${credentialFile}; not printed or committed.`);
}catch{console.error('Admin creation failed. Check ADMIN_EMAIL, migrations, duplicate account or existing .local/admin-credentials.txt. No existing account was reset.');process.exitCode=1;}
finally{await pool.end();}
