'use strict';
const http=require('http'), fs=require('fs'),path=require('path'),crypto=require('crypto'),mssql=require('mssql');
const ROOT=path.resolve(__dirname,'../..'),PUB=path.join(ROOT,'public');
if(fs.existsSync(path.join(ROOT,'.env')))for(const line of fs.readFileSync(path.join(ROOT,'.env'),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z_][A-Z_0-9]*)=(.*)$/i);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]}
const CONNECTION=process.env.ConnectionStrings__DefaultConnection||process.env.DB_CONNECTION_STRING;
const PORT=+(process.env.HTTP_PLATFORM_PORT||process.env.PORT||3000);
const currentDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const iso=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
let pool;
async function db(){if(!pool||!pool.connected)pool=await new mssql.ConnectionPool(CONNECTION).connect();return pool}
async function q(text,params={}){const r=(await db()).request();for(const [k,v] of Object.entries(params))r.input(k,v);return r.query(text)}
function error(message,status=400){let e=new Error(message);e.status=status;throw e}
function respond(res,status,data,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data))}
async function body(req){let s='';for await(const c of req){s+=c;if(s.length>100000)error('Requisição muito grande',413)}try{return s?JSON.parse(s):{}}catch{error('JSON inválido')}}
function validDate(v){if(v==null||v==='')return null;const s=String(v);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(Date.parse(s))||new Date(s+'T12:00:00Z').toISOString().slice(0,10)!==s)error('Data inválida');return s}
function validMoney(v){const s=String(v??'').trim().replace(',','.');if(!/^\d{1,13}(\.\d{1,2})?$/.test(s))error('Valor monetário inválido');return s}
function asCents(v){const [a,b='']=String(v).split('.');return Number(a)*100+Number((b+'00').slice(0,2))}
function fromCents(v){return (v/100).toFixed(2)}
function monthPlus(d,n){const [y,m,day]=d.split('-').map(Number);const z=new Date(Date.UTC(y,m-1+n,1));const last=new Date(Date.UTC(z.getUTCFullYear(),z.getUTCMonth()+1,0)).getUTCDate();return z.toISOString().slice(0,8)+String(Math.min(day,last)).padStart(2,'0')}
function nextOccurrence(date,period,index){if(period==='weekly'){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+index*7);return d.toISOString().slice(0,10)}return monthPlus(date,index*(period==='yearly'?12:1))}
const esc=(s,n=250)=>String(s??'').trim().slice(0,n);
function passwordHash(pass){const salt=crypto.randomBytes(16).toString('hex');return salt+':'+crypto.scryptSync(pass,salt,64).toString('hex')}
function passwordValid(pass,stored){try{const [salt,h]=String(stored).split(':');const a=Buffer.from(h,'hex'),b=crypto.scryptSync(pass,salt,64);return a.length===b.length&&crypto.timingSafeEqual(a,b)}catch{return false}}
function cookie(req){return (req.headers.cookie||'').match(/(?:^|;\s*)AtlasAuth=([^;]+)/)?.[1]||''}
async function currentUser(req){const token=cookie(req);if(!/^[0-9a-f]{64}$/.test(token))return null;const h=crypto.createHash('sha256').update(token).digest('hex');const r=await q('SELECT u.Id,u.Nome,u.Email FROM dbo.Usuarios u INNER JOIN dbo.AtlasV2Sessions s ON s.UserId=u.Id WHERE s.TokenHash=@h AND s.ExpiresAt>SYSUTCDATETIME() AND u.Ativo=1',{h});return r.recordset[0]||null}
async function audit(uid,entity,id,action,info){await q('INSERT INTO dbo.AtlasV2Audit(UserId,Entity,EntityId,Action,Info) VALUES(@u,@e,@id,@a,@i)',{u:uid,e:entity,id:String(id),a:action,i:JSON.stringify(info).slice(0,7000)})}
const models={
 personal:{transactions:{table:'AtlasV2PersonalTransactions',fields:['kind','description','amount','category','subcategory','entry_date','competence','due_date','payment_date','status','account_id','card_id','payment_method','notes','series_id','installment_group','installment_number','installment_total'],money:['amount'],date:['entry_date','competence','due_date','payment_date'],int:['account_id','card_id','installment_number','installment_total']},accounts:{table:'AtlasV2PersonalAccounts',fields:['name','kind','opening_balance','active'],money:['opening_balance'],bool:['active']},cards:{table:'AtlasV2PersonalCards',fields:['name','credit_limit','closing_day','due_day','active'],money:['credit_limit'],int:['closing_day','due_day'],bool:['active']},goals:{table:'AtlasV2Goals',fields:['name','target_amount','current_amount','target_date','status','notes','metric'],money:['target_amount','current_amount'],date:['target_date'],module:true}},
 company:{sales:{table:'AtlasV2CompanySales',fields:['description','amount','entry_date','competence','status','payment_method','service_id','notes','series_id'],money:['amount'],date:['entry_date','competence'],int:['service_id']},expenses:{table:'AtlasV2CompanyExpenses',fields:['description','amount','category','expense_type','entry_date','competence','due_date','payment_date','status','payment_method','notes','series_id'],money:['amount'],date:['entry_date','competence','due_date','payment_date']},services:{table:'AtlasV2CompanyServices',fields:['name','default_price','active'],money:['default_price'],bool:['active']},goals:{table:'AtlasV2Goals',fields:['name','target_amount','current_amount','target_date','status','notes','metric'],money:['target_amount','current_amount'],date:['target_date'],module:true}}
};
function parse(m,input,partial=false){let out={};for(const key of m.fields)if(Object.prototype.hasOwnProperty.call(input,key)){let v=input[key];if(v===''||v===null)v=null;else if(m.money?.includes(key))v=validMoney(v);else if(m.date?.includes(key))v=validDate(v);else if(m.int?.includes(key)){v=Number(v);if(!Number.isInteger(v)||v<1)error('Número inválido: '+key)}else if(m.bool?.includes(key))v=v?1:0;else v=esc(v,500);out[key]=v}if(!partial){if(m.fields.includes('name')&&!out.name)error('Informe o nome');if(m.fields.includes('description')&&!out.description)error('Informe a descrição');if(m.fields.includes('amount')&&!out.amount)error('Informe o valor')}if(out.kind&&!['income','expense','checking','savings','cash','digital'].includes(out.kind))error('Tipo inválido');if(out.closing_day&&out.closing_day>31||out.due_day&&out.due_day>31)error('Dia deve estar entre 1 e 31');if(out.metric&&!['revenue','reserve','custom'].includes(out.metric))error('Indicador inválido');if(out.status&&!['pending','paid','cancelled','received','projected','active','completed','paused'].includes(out.status))error('Status inválido');return out}
async function getOwned(mod,kind,id,uid){const m=models[mod]?.[kind];if(!m)error('Recurso desconhecido',404);const r=await q('SELECT * FROM dbo.'+m.table+' WHERE id=@id AND user_id=@u'+(m.module?' AND module=@mod':''),{id:Number(id),u:uid,...(m.module?{mod}: {})});if(!r.recordset.length)error('Registro não encontrado',404);return r.recordset[0]}
async function create(mod,kind,uid,values,internal=false){const m=models[mod]?.[kind];if(!m)error('Recurso inválido',404);const o=parse(m,values);if(!internal)for(const k of ['series_id','installment_group','installment_number','installment_total'])delete o[k];const today=currentDate();if(m.fields.includes('entry_date'))o.entry_date=o.entry_date||today;if(m.fields.includes('competence'))o.competence=o.competence||o.entry_date;if(m.fields.includes('status'))o.status=o.status||(kind==='sales'?'received':kind==='goals'?'active':o.kind==='income'?'received':'pending');if(o.account_id)await getOwned('personal','accounts',o.account_id,uid);if(o.card_id)await getOwned('personal','cards',o.card_id,uid);if(o.service_id)await getOwned('company','services',o.service_id,uid);const params={u:uid,...o};let cols=['user_id',...Object.keys(o)],vals=['@u',...Object.keys(o).map(k=>'@'+k)];if(m.module){cols.push('module');vals.push('@mod');params.mod=mod}const result=await q('INSERT INTO dbo.'+m.table+' ('+cols.join(',')+') OUTPUT INSERTED.id VALUES ('+vals.join(',')+')',params);const id=result.recordset[0].id;await audit(uid,m.table,id,'CREATE',o);return {id}}
async function update(mod,kind,uid,id,changes){const m=models[mod]?.[kind],before=await getOwned(mod,kind,id,uid),obj=parse(m,changes,true);for(const k of ['series_id','installment_group','installment_number','installment_total'])delete obj[k];if(obj.account_id)await getOwned('personal','accounts',obj.account_id,uid);if(obj.card_id)await getOwned('personal','cards',obj.card_id,uid);if(obj.service_id)await getOwned('company','services',obj.service_id,uid);const keys=Object.keys(obj);if(!keys.length)error('Informe uma alteração');await q('UPDATE dbo.'+m.table+' SET '+keys.map(k=>k+'=@'+k).join(',')+' WHERE id=@id AND user_id=@u'+(m.module?' AND module=@mod':''),{...obj,id:Number(id),u:uid,...(m.module?{mod}:{})});await audit(uid,m.table,id,'UPDATE',{before,changes:obj});return {id:Number(id)}}
async function del(mod,kind,uid,id){const m=models[mod]?.[kind],before=await getOwned(mod,kind,id,uid);await q('DELETE FROM dbo.'+m.table+' WHERE id=@id AND user_id=@u'+(m.module?' AND module=@mod':''),{id:Number(id),u:uid,...(m.module?{mod}:{})});await audit(uid,m.table,id,'DELETE',before);return {deleted:true}}
async function items(mod,kind,uid,search){const m=models[mod]?.[kind];if(!m)error('Recurso inválido',404);const params={u:uid};let where='user_id=@u'+(m.module?' AND module=@mod':'');if(m.module)params.mod=mod;if(search.get('month')&&m.fields.includes('competence')){const month=search.get('month');if(!/^\d{4}-\d{2}$/.test(month))error('Mês inválido');params.start=month+'-01';params.end=monthPlus(params.start,1);where+=' AND competence>=@start AND competence<@end'}if(search.get('year')&&m.fields.includes('competence')){const year=search.get('year');if(!/^\d{4}$/.test(year))error('Ano inválido');params.start=year+'-01-01';params.end=(+year+1)+'-01-01';where+=' AND competence>=@start AND competence<@end'}return (await q('SELECT TOP 2000 * FROM dbo.'+m.table+' WHERE '+where+' ORDER BY id DESC',params)).recordset}
async function generate(mod,kind,uid,data){
  if(!['transactions','expenses','sales'].includes(kind)||!models[mod]?.[kind])error('Série inválida');
  const mode=data.mode;if(!['recurring','installments'].includes(mode))error('Modo inválido');
  const installment=mode==='installments';
  if(installment&&(mod!=='personal'||kind!=='transactions'||data.kind!=='expense'))error('Parcelamento disponível somente para despesas pessoais');
  const count=Number(data.count||(installment?12:12));
  if(!Number.isInteger(count)||count<1||count>120)error('Quantidade deve estar entre 1 e 120');
  const periodicity=data.periodicity||'monthly';if(!['weekly','monthly','yearly'].includes(periodicity))error('Periodicidade inválida');
  const start=validDate(data.competence||data.entry_date||currentDate()),end=validDate(data.end_date);
  if(end&&end<start)error('O término deve ser posterior à data inicial');
  const base=parse(models[mod][kind],data);base.entry_date=base.entry_date||start;base.competence=start;
  const group=crypto.randomUUID(),ids=[];
  if(!installment){
    await q('INSERT INTO dbo.AtlasV2Series(id,user_id,module,entity,periodicity,start_date,end_date,TemplateJson,MaxOccurrences,CreatedThrough) VALUES(@id,@u,@m,@e,@p,@start,@end,@template,@maximum,-1)',
      {id:group,u:uid,m:mod,e:kind,p:periodicity,start,end,template:JSON.stringify(base),maximum:data.open_ended===true?null:count});
  }
  const total=asCents(validMoney(data.amount)),individual=Math.floor(total/count),remainder=total%count;
  for(let i=0;i<count;i++){
    const competence=nextOccurrence(start,periodicity,i);if(end&&competence>end)break;
    const record={...base,entry_date:nextOccurrence(base.entry_date,periodicity,i),competence,
      due_date:base.due_date?nextOccurrence(base.due_date,periodicity,i):null,
      payment_date:null};
    if(installment){record.amount=fromCents(individual+(i<remainder?1:0));record.installment_group=group;record.installment_number=i+1;record.installment_total=count;record.status='pending'}
    else{record.series_id=group;record.status=kind==='sales'||record.kind==='income'?'projected':'pending'}
    ids.push((await create(mod,kind,uid,record,true)).id);
  }
  if(!installment)await q('UPDATE dbo.AtlasV2Series SET CreatedThrough=@i WHERE id=@id AND user_id=@u',{i:ids.length-1,id:group,u:uid});
  await audit(uid,models[mod][kind].table,group,installment?'INSTALLMENTS':'RECURRENCE_CREATE',{count:ids.length,periodicity,end});
  return {ids,group,mode};
}
async function advanceRecurrences(uid,horizon){
  // Open-ended series extend automatically when a future month is consulted.
  const series=(await q('SELECT * FROM dbo.AtlasV2Series WHERE user_id=@u AND active=1 AND TemplateJson IS NOT NULL',{u:uid})).recordset;
  for(const s of series){
    const mod=s.module,kind=s.entity;if(!models[mod]?.[kind])continue;
    const start=iso(s.start_date),end=s.end_date?iso(s.end_date):null;
    const revisions=(await q('SELECT * FROM dbo.AtlasV2SeriesChanges WHERE user_id=@u AND series_id=@s ORDER BY start_date',{u:uid,s:s.id})).recordset;
    const base=JSON.parse(s.TemplateJson);let i=Math.max(0,Number(s.CreatedThrough)+1);
    const limit=s.MaxOccurrences==null?600:Number(s.MaxOccurrences);
    let last=i-1;
    for(;i<limit;i++){
      const competence=nextOccurrence(start,s.periodicity,i);
      if(competence>horizon||(end&&competence>end))break;
      const current={...base};
      current.entry_date=nextOccurrence(base.entry_date||start,s.periodicity,i);
      current.competence=competence;
      current.due_date=base.due_date?nextOccurrence(base.due_date,s.periodicity,i):null;
      for(const revision of revisions){if(iso(revision.start_date)<=competence)Object.assign(current,JSON.parse(revision.TemplateJson));}
      current.payment_date=null;current.series_id=s.id;
      current.status=kind==='sales'||current.kind==='income'?'projected':'pending';
      try{await create(mod,kind,uid,current,true);}catch(e){if(![2601,2627].includes(e.number))throw e;}
      last=i;
    }
    if(last>=Number(s.CreatedThrough))await q('UPDATE dbo.AtlasV2Series SET CreatedThrough=@last WHERE user_id=@u AND id=@id AND CreatedThrough<@last',{last,u:uid,id:s.id});
  }
}
async function changeSeries(mod,kind,uid,id,data){
  const row=await getOwned(mod,kind,id,uid),m=models[mod][kind];if(!row.series_id)error('Lançamento não vinculado a recorrência');
  if(data.action==='stop'){
    await q('UPDATE dbo.AtlasV2Series SET active=0,end_date=@d WHERE user_id=@u AND id=@s',{u:uid,s:row.series_id,d:row.competence});
    await q('DELETE FROM dbo.'+m.table+" WHERE user_id=@u AND series_id=@s AND competence>@d AND status IN ('pending','projected')",{u:uid,s:row.series_id,d:row.competence});
    await audit(uid,m.table,id,'RECURRENCE_STOP',{at:row.competence});return {stopped:true};
  }
  const changes=parse(m,data.changes||{},true);
  for(const f of ['series_id','installment_group','installment_number','installment_total','entry_date','competence'])delete changes[f];
  if(!Object.keys(changes).length)error('Informe a alteração');
  if(data.scope==='future'){
    await q('INSERT INTO dbo.AtlasV2SeriesChanges(user_id,series_id,start_date,TemplateJson) VALUES(@u,@s,@d,@j)',{u:uid,s:row.series_id,d:row.competence,j:JSON.stringify(changes)});
    await q('UPDATE dbo.'+m.table+' SET '+Object.keys(changes).map(k=>k+'=@'+k).join(',')+" WHERE user_id=@u AND series_id=@s AND competence>=@d AND status IN ('pending','projected')",{...changes,u:uid,s:row.series_id,d:row.competence});
  }else await update(mod,kind,uid,id,changes);
  await audit(uid,m.table,id,'RECURRENCE_UPDATE',{scope:data.scope==='future'?'future':'single',changes});return {updated:true};
}
async function dashboard(mod,uid,month){
  if(!/^\d{4}-\d{2}$/.test(month))error('Mês inválido');
  const start=month+'-01',end=monthPlus(start,1),personal=mod==='personal';
  const rev=personal?'AtlasV2PersonalTransactions':'AtlasV2CompanySales';
  const exp=personal?'AtlasV2PersonalTransactions':'AtlasV2CompanyExpenses';
  const rw=personal?"kind='income' AND ":'',ew=personal?"kind='expense' AND ":'';
  const params={u:uid,start,end};
  const r=(await q("SELECT COALESCE(SUM(CASE WHEN status IN ('received','paid') THEN amount ELSE 0 END),0) realized,COALESCE(SUM(CASE WHEN status='projected' THEN amount ELSE 0 END),0) projected,COUNT(CASE WHEN status IN ('received','paid') THEN 1 END) quantity FROM dbo."+rev+' WHERE user_id=@u AND '+rw+'competence>=@start AND competence<@end',params)).recordset[0];
  const e=(await q("SELECT COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END),0) paid,COALESCE(SUM(CASE WHEN status='pending' THEN amount ELSE 0 END),0) pending FROM dbo."+exp+' WHERE user_id=@u AND '+ew+'competence>=@start AND competence<@end',params)).recordset[0];
  const categories=(await q("SELECT TOP 8 COALESCE(NULLIF(category,''),'Outros') category,SUM(amount) total FROM dbo."+exp+' WHERE user_id=@u AND '+ew+"status<>'cancelled' AND competence>=@start AND competence<@end GROUP BY category ORDER BY total DESC",params)).recordset;
  const history=[];
  for(let i=5;i>=0;i--){
    const a=monthPlus(start,-i),b=monthPlus(a,1),p={u:uid,start:a,end:b};
    const rr=(await q("SELECT COALESCE(SUM(amount),0) v FROM dbo."+rev+' WHERE user_id=@u AND '+rw+"status IN ('received','paid') AND competence>=@start AND competence<@end",p)).recordset[0].v;
    const ee=(await q("SELECT COALESCE(SUM(amount),0) v FROM dbo."+exp+' WHERE user_id=@u AND '+ew+"status='paid' AND competence>=@start AND competence<@end",p)).recordset[0].v;
    history.push({month:a.slice(0,7),revenue:rr,expenses:ee,profit:Number(rr)-Number(ee)});
  }
  const recent=(await q('SELECT TOP 8 id,description,amount,competence,status,'+(personal?'kind':'expense_type')+' kind FROM dbo.'+exp+' WHERE user_id=@u AND competence>=@start AND competence<@end ORDER BY id DESC',params)).recordset;
  const upcoming=(await q("SELECT TOP 8 id,description,amount,due_date FROM dbo."+exp+" WHERE user_id=@u AND "+ew+"status='pending' AND due_date>=@today AND due_date<@deadline ORDER BY due_date ASC,id ASC",{u:uid,today:currentDate(),deadline:monthPlus(currentDate(),1)})).recordset;
  const goals=(await q('SELECT TOP 20 id,name,target_amount,current_amount,target_date,status,metric FROM dbo.AtlasV2Goals WHERE user_id=@u AND module=@m ORDER BY id DESC',{u:uid,m:mod})).recordset;
  const extras={};
  if(personal){
    const accounts=(await q("SELECT a.id,a.name,a.kind,a.opening_balance+COALESCE(SUM(CASE WHEN t.kind='income' AND t.status='received' THEN t.amount WHEN t.kind='expense' AND t.status='paid' THEN -t.amount ELSE 0 END),0) balance FROM dbo.AtlasV2PersonalAccounts a LEFT JOIN dbo.AtlasV2PersonalTransactions t ON t.account_id=a.id AND t.user_id=a.user_id WHERE a.user_id=@u AND a.active=1 GROUP BY a.id,a.name,a.kind,a.opening_balance ORDER BY a.name",{u:uid})).recordset;
    extras.accounts=accounts;
  }else{
    extras.services=(await q("SELECT TOP 8 COALESCE(s.name,'Sem serviço') name,COUNT(*) quantity,SUM(v.amount) total FROM dbo.AtlasV2CompanySales v LEFT JOIN dbo.AtlasV2CompanyServices s ON s.id=v.service_id AND s.user_id=v.user_id WHERE v.user_id=@u AND v.competence>=@start AND v.competence<@end AND v.status='received' GROUP BY s.name ORDER BY quantity DESC",params)).recordset;
    extras.payments=(await q("SELECT COALESCE(NULLIF(payment_method,''),'Não informado') method,SUM(amount) total FROM dbo.AtlasV2CompanySales WHERE user_id=@u AND status='received' AND competence>=@start AND competence<@end GROUP BY payment_method ORDER BY total DESC",params)).recordset;
    const revenueTarget=goals.find(g=>g.metric==='revenue'&&iso(g.target_date).slice(0,7)===month&&g.status==='active');
    if(revenueTarget){const now=currentDate(),last=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).getUTCDate(),days=month<now.slice(0,7)?0:month>now.slice(0,7)?last:last-Number(now.slice(8))+1;extras.target={amount:revenueTarget.target_amount,remaining:Math.max(0,Number(revenueTarget.target_amount)-Number(r.realized)),days,daily:days?Math.max(0,Number(revenueTarget.target_amount)-Number(r.realized))/days:0};}
  }
  return {revenue:r.realized,projected:r.projected,expenses:e.paid,pending:e.pending,quantity:r.quantity,categories,history,recent,upcoming,goals,...extras};
}
async function setupDB(){if(!CONNECTION)throw Error('ConnectionStrings__DefaultConnection não configurada');await q(`
IF OBJECT_ID('dbo.Usuarios','U') IS NULL CREATE TABLE dbo.Usuarios(Id INT IDENTITY PRIMARY KEY,Nome NVARCHAR(120) NOT NULL,Email NVARCHAR(180) NOT NULL UNIQUE,PasswordHash NVARCHAR(300) NOT NULL,Role VARCHAR(20) NOT NULL DEFAULT 'USER',Ativo BIT NOT NULL DEFAULT 1,CriadoEm DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
IF OBJECT_ID('dbo.AtlasV2Sessions','U') IS NULL CREATE TABLE dbo.AtlasV2Sessions(TokenHash CHAR(64) PRIMARY KEY,UserId INT NOT NULL,ExpiresAt DATETIME2 NOT NULL);
IF OBJECT_ID('dbo.AtlasV2Audit','U') IS NULL CREATE TABLE dbo.AtlasV2Audit(id BIGINT IDENTITY PRIMARY KEY,UserId INT NOT NULL,Entity NVARCHAR(90),EntityId NVARCHAR(100),Action NVARCHAR(40),Info NVARCHAR(MAX),CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
IF OBJECT_ID('dbo.AtlasV2PersonalAccounts','U') IS NULL CREATE TABLE dbo.AtlasV2PersonalAccounts(id INT IDENTITY PRIMARY KEY,user_id INT NOT NULL,name NVARCHAR(150) NOT NULL,kind NVARCHAR(50),opening_balance DECIMAL(18,2) NOT NULL DEFAULT 0,active BIT NOT NULL DEFAULT 1);
IF OBJECT_ID('dbo.AtlasV2PersonalCards','U') IS NULL CREATE TABLE dbo.AtlasV2PersonalCards(id INT IDENTITY PRIMARY KEY,user_id INT NOT NULL,name NVARCHAR(150) NOT NULL,credit_limit DECIMAL(18,2) NOT NULL DEFAULT 0,closing_day INT,due_day INT,active BIT NOT NULL DEFAULT 1);
IF OBJECT_ID('dbo.AtlasV2CompanyServices','U') IS NULL CREATE TABLE dbo.AtlasV2CompanyServices(id INT IDENTITY PRIMARY KEY,user_id INT NOT NULL,name NVARCHAR(150) NOT NULL,default_price DECIMAL(18,2) NOT NULL DEFAULT 0,active BIT NOT NULL DEFAULT 1);
IF OBJECT_ID('dbo.AtlasV2Goals','U') IS NULL CREATE TABLE dbo.AtlasV2Goals(id INT IDENTITY PRIMARY KEY,user_id INT NOT NULL,module VARCHAR(12) NOT NULL,name NVARCHAR(150) NOT NULL,target_amount DECIMAL(18,2) NOT NULL,current_amount DECIMAL(18,2) NOT NULL DEFAULT 0,target_date DATE,status VARCHAR(25) DEFAULT 'active',notes NVARCHAR(500),metric VARCHAR(30) NULL);
IF OBJECT_ID('dbo.AtlasV2Series','U') IS NULL CREATE TABLE dbo.AtlasV2Series(id UNIQUEIDENTIFIER PRIMARY KEY,user_id INT NOT NULL,module VARCHAR(12) NOT NULL,entity VARCHAR(25) NOT NULL,periodicity VARCHAR(12),start_date DATE,end_date DATE,active BIT NOT NULL DEFAULT 1);
IF OBJECT_ID('dbo.AtlasV2PersonalTransactions','U') IS NULL CREATE TABLE dbo.AtlasV2PersonalTransactions(id INT IDENTITY PRIMARY KEY,user_id INT NOT NULL,kind VARCHAR(10) NOT NULL,description NVARCHAR(250) NOT NULL,amount DECIMAL(18,2) NOT NULL,category NVARCHAR(100),subcategory NVARCHAR(100),entry_date DATE NOT NULL,competence DATE NOT NULL,due_date DATE,payment_date DATE,status VARCHAR(20) NOT NULL,account_id INT,card_id INT,payment_method NVARCHAR(80),notes NVARCHAR(500),series_id UNIQUEIDENTIFIER,installment_group UNIQUEIDENTIFIER,installment_number INT,installment_total INT);
IF OBJECT_ID('dbo.AtlasV2CompanySales','U') IS NULL CREATE TABLE dbo.AtlasV2CompanySales(id INT IDENTITY PRIMARY KEY,user_id INT NOT NULL,description NVARCHAR(250) NOT NULL,amount DECIMAL(18,2) NOT NULL,entry_date DATE NOT NULL,competence DATE NOT NULL,status VARCHAR(20) NOT NULL,payment_method NVARCHAR(80),service_id INT,notes NVARCHAR(500),series_id UNIQUEIDENTIFIER);
IF OBJECT_ID('dbo.AtlasV2CompanyExpenses','U') IS NULL CREATE TABLE dbo.AtlasV2CompanyExpenses(id INT IDENTITY PRIMARY KEY,user_id INT NOT NULL,description NVARCHAR(250) NOT NULL,amount DECIMAL(18,2) NOT NULL,category NVARCHAR(100),expense_type NVARCHAR(20),entry_date DATE NOT NULL,competence DATE NOT NULL,due_date DATE,payment_date DATE,status VARCHAR(20) NOT NULL,payment_method NVARCHAR(80),notes NVARCHAR(500),series_id UNIQUEIDENTIFIER);
IF COL_LENGTH('dbo.AtlasV2Goals','metric') IS NULL ALTER TABLE dbo.AtlasV2Goals ADD metric VARCHAR(30) NULL;
IF COL_LENGTH('dbo.AtlasV2Series','TemplateJson') IS NULL ALTER TABLE dbo.AtlasV2Series ADD TemplateJson NVARCHAR(MAX) NULL;
IF COL_LENGTH('dbo.AtlasV2Series','MaxOccurrences') IS NULL ALTER TABLE dbo.AtlasV2Series ADD MaxOccurrences INT NULL;
IF COL_LENGTH('dbo.AtlasV2Series','CreatedThrough') IS NULL ALTER TABLE dbo.AtlasV2Series ADD CreatedThrough INT NOT NULL CONSTRAINT DF_AtlasV2Series_CreatedThrough DEFAULT(-1);
IF OBJECT_ID('dbo.AtlasV2SeriesChanges','U') IS NULL CREATE TABLE dbo.AtlasV2SeriesChanges(id BIGINT IDENTITY PRIMARY KEY,user_id INT NOT NULL,series_id UNIQUEIDENTIFIER NOT NULL,start_date DATE NOT NULL,TemplateJson NVARCHAR(MAX) NOT NULL);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='UX_AtlasV2PersonalSeriesOccurrence' AND object_id=OBJECT_ID('dbo.AtlasV2PersonalTransactions')) CREATE UNIQUE INDEX UX_AtlasV2PersonalSeriesOccurrence ON dbo.AtlasV2PersonalTransactions(series_id,competence) WHERE series_id IS NOT NULL;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='UX_AtlasV2CompanySalesSeriesOccurrence' AND object_id=OBJECT_ID('dbo.AtlasV2CompanySales')) CREATE UNIQUE INDEX UX_AtlasV2CompanySalesSeriesOccurrence ON dbo.AtlasV2CompanySales(series_id,competence) WHERE series_id IS NOT NULL;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='UX_AtlasV2CompanyExpensesSeriesOccurrence' AND object_id=OBJECT_ID('dbo.AtlasV2CompanyExpenses')) CREATE UNIQUE INDEX UX_AtlasV2CompanyExpensesSeriesOccurrence ON dbo.AtlasV2CompanyExpenses(series_id,competence) WHERE series_id IS NOT NULL;
`)}
async function api(req,res){const url=new URL(req.url,'http://local'),p=url.pathname,m=req.method;if(p==='/api/health')return respond(res,200,{ok:true});if(p==='/api/setup/status'){const result=await q('SELECT COUNT(*) n FROM dbo.Usuarios');return respond(res,200,{required:!Number(result.recordset[0].n)})}if(p==='/api/setup'&&m==='POST'){const b=await body(req);const r=await q('SELECT COUNT(*) n FROM dbo.Usuarios');if(Number(r.recordset[0].n))error('Configuração inicial já concluída',409);if(!b.name||!/^\S+@\S+\.\S+$/.test(String(b.email||''))||String(b.password||'').length<10)error('Nome, e-mail e senha de no mínimo 10 caracteres são obrigatórios');await q("INSERT INTO dbo.Usuarios(Nome,Email,PasswordHash,Role) VALUES(@n,@e,@p,'ADMIN')",{n:esc(b.name,120),e:esc(b.email,180).toLowerCase(),p:passwordHash(b.password)});return respond(res,201,{created:true})}if(p==='/api/login'&&m==='POST'){const b=await body(req),r=await q('SELECT TOP 1 Id,Nome,PasswordHash FROM dbo.Usuarios WHERE Email=@e AND Ativo=1',{e:esc(b.email,180).toLowerCase()}),user=r.recordset[0];if(!user||!passwordValid(b.password||'',user.PasswordHash))error('Credenciais inválidas',401);const token=crypto.randomBytes(32).toString('hex'),h=crypto.createHash('sha256').update(token).digest('hex');await q('INSERT INTO dbo.AtlasV2Sessions(TokenHash,UserId,ExpiresAt) VALUES(@h,@id,DATEADD(DAY,7,SYSUTCDATETIME()))',{h,id:user.Id});return respond(res,200,{name:user.Nome},{'Set-Cookie':'AtlasAuth='+token+'; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800'+(process.env.NODE_ENV==='production'?'; Secure':'')})}const user=await currentUser(req);if(!user)error('Faça login para continuar',401);if(p==='/api/me')return respond(res,200,{name:user.Nome,email:user.Email});if(p==='/api/logout'&&m==='POST'){await q('DELETE FROM dbo.AtlasV2Sessions WHERE TokenHash=@h',{h:crypto.createHash('sha256').update(cookie(req)).digest('hex')});return respond(res,200,{ok:true},{'Set-Cookie':'AtlasAuth=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'})}if(p==='/api/dashboard'){const mod=url.searchParams.get('module'),month=url.searchParams.get('month')||currentDate().slice(0,7);if(!models[mod]||!/^\d{4}-\d{2}$/.test(month))error('Módulo ou mês inválido');await advanceRecurrences(user.Id,monthPlus(month+'-01',6));return respond(res,200,await dashboard(mod,user.Id,month))}if(p==='/api/reports'){const mod=url.searchParams.get('module'),year=url.searchParams.get('year');if(!models[mod]||!/^\d{4}$/.test(year||''))error('Ano inválido');await advanceRecurrences(user.Id,(Number(year)+1)+'-06-01');const months=[];for(let i=1;i<=12;i++)months.push({month:year+'-'+String(i).padStart(2,'0'),...await dashboard(mod,user.Id,year+'-'+String(i).padStart(2,'0'))});return respond(res,200,months)}const mt=p.match(/^\/api\/(personal|company)\/(transactions|sales|expenses|accounts|cards|services|goals)(?:\/(\d+))?(?:\/(status|series))?$/);if(!mt)error('Rota desconhecida',404);const [,mod,kind,id,action]=mt;if(!models[mod]?.[kind])error('Área inválida',404);if(m==='GET'&&!id){if(['transactions','expenses','sales'].includes(kind)){const month=url.searchParams.get('month')||currentDate().slice(0,7);if(/^\d{4}-\d{2}$/.test(month))await advanceRecurrences(user.Id,monthPlus(month+'-01',2));}return respond(res,200,await items(mod,kind,user.Id,url.searchParams));}if(m==='GET'&&id)return respond(res,200,await getOwned(mod,kind,id,user.Id));if(m==='POST'&&!id){const b=await body(req);return respond(res,201,b.mode==='recurring'||b.mode==='installments'?await generate(mod,kind,user.Id,b):await create(mod,kind,user.Id,b))}if(m==='DELETE'&&id&&!action)return respond(res,200,await del(mod,kind,user.Id,id));if((m==='PUT'||m==='PATCH')&&id&&!action)return respond(res,200,await update(mod,kind,user.Id,id,await body(req)));if(m==='POST'&&action==='series')return respond(res,200,await changeSeries(mod,kind,user.Id,id,await body(req)));if(m==='POST'&&action==='status'){const b=await body(req);if(!['paid','pending','received','projected','cancelled','active','completed'].includes(b.status))error('Status inválido');const obj={status:b.status};if(models[mod][kind].fields.includes('payment_date'))obj.payment_date=b.status==='paid'?(validDate(b.payment_date)||currentDate()):null;return respond(res,200,await update(mod,kind,user.Id,id,obj))}error('Método inválido',405)}
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{try{if(req.method!=='GET'&&req.method!=='HEAD'&&req.headers.origin){const expected=req.headers['x-forwarded-host']||req.headers.host;if(new URL(req.headers.origin).host!==expected)error('Origem não permitida',403)}if(req.url.startsWith('/api/'))return await api(req,res);if(req.method!=='GET')error('Método não permitido',405);const name=new URL(req.url,'http://local').pathname;const filename=path.resolve(PUB,'.'+(name==='/'?'/index.html':name));if(!filename.startsWith(PUB+path.sep)||!fs.existsSync(filename)||!fs.statSync(filename).isFile())error('Arquivo não encontrado',404);res.writeHead(200,{'Content-Type':MIME[path.extname(filename)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});fs.createReadStream(filename).pipe(res)}catch(e){if(!e.status)console.error(e);respond(res,e.status||500,{error:e.status?e.message:'Erro interno do sistema'})}});
setupDB().then(()=>server.listen(PORT,()=>console.log('ATLAS online na porta '+PORT))).catch(e=>{console.error('Inicialização falhou:',e.message);process.exit(1)});