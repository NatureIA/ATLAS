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
  init();
})();
