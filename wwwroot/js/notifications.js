(() => {
  'use strict';
  const invite=document.getElementById('atlasPushInvite');
  if(!invite)return;
  const accept=document.getElementById('atlasPushAccept');
  const later=document.getElementById('atlasPushLater');
  const feedback=document.getElementById('atlasPushInviteFeedback');
  const token=invite.querySelector('input[name="__RequestVerificationToken"]')?.value||'';
  const dismissalKey='atlas-push-invite-dismissed-v1';
  const supported=window.isSecureContext && 'serviceWorker' in navigator &&
    'PushManager' in window && 'Notification' in window;
  const message=value=>{feedback.textContent=value;};
  const toBytes=key=>{
    const base64=key.replace(/-/g,'+').replace(/_/g,'/');
    const binary=atob(base64.padEnd(Math.ceil(base64.length/4)*4,'='));
    return Uint8Array.from(binary,c=>c.charCodeAt(0));
  };
  const post=async payload=>{
    const response=await fetch('/api/push/subscribe',{
      method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json','RequestVerificationToken':token},
      body:JSON.stringify(payload)
    });
    if(!response.ok)throw new Error('Falha ao registrar notificações ('+response.status+').');
  };
  async function registerSubscription(registration,publicKey){
    const old=await registration.pushManager.getSubscription();
    const subscription=old||await registration.pushManager.subscribe({
      userVisibleOnly:true,applicationServerKey:toBytes(publicKey)
    });
    const json=subscription.toJSON();
    try{
      await post({
        endpoint:subscription.endpoint,
        p256dh:json.keys?.p256dh||'',
        auth:json.keys?.auth||''
      });
    }catch(error){
      if(!old)await subscription.unsubscribe().catch(()=>{});
      throw error;
    }
  }
  function close(){
    invite.hidden=true;
    document.body.classList.remove('atlas-push-invite-open');
  }
  function show(){
    invite.hidden=false;
    document.body.classList.add('atlas-push-invite-open');
    accept.focus();
  }
  async function init(){
    if(!supported || Notification.permission==='denied')return;
    try{
      const response=await fetch('/api/push/config',{credentials:'same-origin',cache:'no-store'});
      if(!response.ok)return;
      const config=await response.json();
      if(!config.enabled || !config.publicKey)return;
      const registration=await navigator.serviceWorker.register(
        '/service-worker.js',{scope:'/',updateViaCache:'none'});
      await navigator.serviceWorker.ready;
      const existing=await registration.pushManager.getSubscription();
      if(existing && Notification.permission==='granted'){
        await registerSubscription(registration,config.publicKey);
        return;
      }
      // Permission already granted: register without another user interaction.
      if(Notification.permission==='granted'){
        await registerSubscription(registration,config.publicKey);
        return;
      }
      try{if(localStorage.getItem(dismissalKey)==='yes')return;}catch(_){}
      // Browser policies require the native permission request to originate from a click.
      show();
      later.addEventListener('click',()=>{
        try{localStorage.setItem(dismissalKey,'yes');}catch(_){}
        close();
      });
      accept.addEventListener('click',async()=>{
        accept.disabled=true;
        message('Solicitando autorização ao dispositivo...');
        try{
          const permission=await Notification.requestPermission();
          if(permission!=='granted'){
            message('Permissão não concedida. Você pode autorizá-la nas configurações do navegador.');
            accept.disabled=false;
            return;
          }
          message('Registrando o dispositivo...');
          await registerSubscription(registration,config.publicKey);
          try{localStorage.removeItem(dismissalKey);}catch(_){}
          close();
        }catch(error){
          message(error.message||'Não foi possível ativar notificações.');
          accept.disabled=false;
        }
      });
    }catch(error){
      console.warn('ATLAS: notificações indisponíveis',error);
      close();
    }
  }
  const status=document.getElementById('atlasPushStatus');
  const testButton=document.getElementById('atlasPushTest');
  async function statusCheck(){
    if(!status)return;
    try{
      const response=await fetch('/api/push/status',{credentials:'same-origin',cache:'no-store'});
      if(!response.ok)throw new Error('Consulta falhou.');
      const x=await response.json();
      status.textContent=!x.configured?'Notificações não configuradas no servidor'
        :x.activeDevices===0?'Nenhum dispositivo ativo registrado'
        :x.overdue+' despesa(s) vencida(s) · '+x.activeDevices+' dispositivo(s) ativo(s)'+
          (x.lastAcceptedUtc?' · Último envio aceito: '+new Date(x.lastAcceptedUtc).toLocaleString('pt-BR'):' · Nenhum envio confirmado');
    }catch(e){status.textContent='Status de notificações indisponível';}
  }
  if(testButton)testButton.addEventListener('click',async()=>{
    testButton.disabled=true;
    if(status)status.textContent='Tentando enviar notificação…';
    try{
      if(!supported||Notification.permission!=='granted')
        throw new Error('Notificações não autorizadas neste navegador');
      const registration=await navigator.serviceWorker.ready;
      const sub=await registration.pushManager.getSubscription();
      if(!sub)throw new Error('Este navegador não possui assinatura');
      const response=await fetch('/api/push/test',{method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/json','RequestVerificationToken':token},
        body:JSON.stringify({endpoint:sub.endpoint})});
      const x=await response.json();
      if(status)status.textContent=x.message||'Erro no teste';
    }catch(e){if(status)status.textContent=e.message||'Falha no teste';}
    finally{testButton.disabled=false;}
  });
  statusCheck();
  init();
})();
