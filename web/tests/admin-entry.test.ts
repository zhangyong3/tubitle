import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
const dir = await mkdtemp(join(tmpdir(), 'tubitle-admin-entry-'));
Object.assign(process.env, { DATABASE_PROVIDER:'sqlite', DATABASE_URL:`file:${dir}/test.db`, AUTH_SECRET:'isolated-admin-entry-test-secret', NODE_ENV:'test', VITE_APP_URL:'http://localhost:3000' });
execFileSync(process.execPath,['node_modules/drizzle-kit/bin.cjs','push','--dialect=sqlite','--schema=./src/config/db/schema.sqlite.ts',`--url=${process.env.DATABASE_URL}`,'--force'],{stdio:'pipe'});
after(()=>rm(dir,{recursive:true,force:true}));
const { db } = await import('../src/core/db');
const { role, permission, rolePermission, userRole } = await import('../src/config/db/schema');
const { testLogin } = await import('./helpers/login');
const { Route } = await import('../src/routes/api/user/permissions');
// Exercise the actual handler used by the layout permission query.
const get = (Route.options as any).server.handlers.GET as (ctx:{request:Request})=>Promise<Response>;
test('admin entry accepts explicit admin.access without requiring all admin permissions', async()=>{
 const login=await testLogin('entry-admin');
 await db().insert(role).values({id:'entry-role',name:'entry-admin',title:'Entry admin',status:'active'});
 await db().insert(permission).values({id:'entry-access',code:'admin.access',resource:'admin',action:'access',title:'Admin access'});
 await db().insert(rolePermission).values({id:'entry-link',roleId:'entry-role',permissionId:'entry-access'});
 await db().insert(userRole).values({id:'entry-user-role',userId:login.userId,roleId:'entry-role'});
 const response=await get({request:new Request('http://localhost:3000/api/user/permissions',{headers:{cookie:login.cookie}})});
 assert.equal((await response.json()).data.isAdmin,true);
 const ordinary=await testLogin('ordinary');
 const denied=await get({request:new Request('http://localhost:3000/api/user/permissions',{headers:{cookie:ordinary.cookie}})});
 assert.equal((await denied.json()).data.isAdmin,false);
});
