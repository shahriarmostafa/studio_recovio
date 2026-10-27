import {readConfig} from './config.js';
import {buildApp} from './app.js';
try{
  const config=readConfig(),app=await buildApp(config);
  for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void app.close().then(()=>process.exit(0));});
  await app.listen({host:config.host,port:config.port});
}catch{console.error('Server startup failed. Check local configuration and port availability.');process.exitCode=1;}
