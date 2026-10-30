(() => {
  'use strict';
  const sidebar=document.querySelector('#sidebar');
  const menuButton=document.querySelector('#menuButton');
  const backdrop=document.querySelector('#menuBackdrop');
  const toggleMenu=open=>{sidebar?.classList.toggle('open',open);backdrop?.classList.toggle('visible',open)};
  menuButton?.addEventListener('click',()=>toggleMenu(!sidebar.classList.contains('open')));
  backdrop?.addEventListener('click',()=>toggleMenu(false));
  sidebar?.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>toggleMenu(false)));
  document.querySelectorAll('form[data-confirm]').forEach(form=>form.addEventListener('submit',e=>{
    if(!window.confirm(form.dataset.confirm))e.preventDefault();
  }));
  const item=document.querySelector('#itemSelect');
  const itemField=document.querySelector('#newItemField');
  const newItem=document.querySelector('#NewItemName');
  function syncItem(){if(!item)return;const open=item.value==='__new__';itemField?.classList.toggle('hidden',!open);if(newItem)newItem.required=open;}
  item?.addEventListener('change',syncItem);syncItem();
  const category=document.querySelector('#categorySelect');
  const categoryField=document.querySelector('#newCategoryField');
  const newCategory=document.querySelector('#NewCategory');
  function syncCategory(){if(!category)return;const open=category.value==='__new__';categoryField?.classList.toggle('hidden',!open);if(newCategory)newCategory.required=open;}
  category?.addEventListener('change',syncCategory);syncCategory();
  // Reports only: independently show/hide each financial series without a reload.
  const performance=document.querySelector('#reportPerformance');
  if(performance){
    const toggles=[...performance.querySelectorAll('.report-performance-flags input[type="checkbox"]')];
    const bars=[...performance.querySelectorAll('.report-performance-bar[data-series]')];
    const plot=performance.querySelector('.report-performance-scroll');
    const empty=performance.querySelector('.report-performance-empty');
    function updatePerformance(){
      const enabled=new Set(toggles.filter(input=>input.checked).map(input=>input.value));
      let positiveMax=0;
      let negativeMax=0;
      bars.forEach(bar=>{
        if(!enabled.has(bar.dataset.series))return;
        const value=Math.max(0,Number(bar.dataset.value)||0);
        if(bar.dataset.side==='negative')negativeMax=Math.max(negativeMax,value);
        else positiveMax=Math.max(positiveMax,value);
      });
      const sum=positiveMax+negativeMax;
      const availablePixels=210;
      performance.style.setProperty('--report-positive-h',(sum>0?availablePixels*positiveMax/sum:availablePixels)+'px');
      performance.style.setProperty('--report-negative-h',(sum>0?availablePixels*negativeMax/sum:0)+'px');
      bars.forEach(bar=>{
        const selected=enabled.has(bar.dataset.series);
        const max=bar.dataset.side==='negative'?negativeMax:positiveMax;
        const value=Math.max(0,Number(bar.dataset.value)||0);
        bar.classList.toggle('is-omitted',!selected);
        bar.style.height=selected&&max>0?(value/max*100)+'%':'0%';
      });
      const noSelection=enabled.size===0;
      if(plot)plot.hidden=noSelection;
      empty?.classList.toggle('hidden',!noSelection);
    }
    toggles.forEach(input=>input.addEventListener('change',updatePerformance));
    updatePerformance();
  }
  const group=document.querySelector('#installmentGroupForm');
  if(group){
    const number=group.querySelector('#Installments');
    const amount=group.querySelector('#Amount');
    const total=group.querySelector('#installmentPreviewTotal');
    const details=group.querySelector('#installmentPreviewDescription');
    const paidCount=Number(group.dataset.paidCount||0);
    const lastPaid=Number(group.dataset.lastPaid||0);
    const paidTotal=Number(group.dataset.paidTotal||0);
    const currency=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
    function preview(){
      const qty=Math.max(0,Number(number?.value||0));
      const value=Math.max(0,Number(amount?.value||0));
      const pending=Math.max(0,qty-paidCount);
      const sum=paidTotal+pending*value;
      if(total)total.textContent=currency.format(sum);
      if(details)details.textContent=qty<lastPaid
        ?'A quantidade não pode ser inferior à última parcela já paga ('+lastPaid+').'
        :paidCount+' parcela(s) paga(s) preservada(s) + '+pending+' parcela(s) pendente(s) de '+currency.format(value)+'.';
      if(details)details.style.color=qty<lastPaid?'#b44040':'';
    }
    number?.addEventListener('input',preview);
    amount?.addEventListener('input',preview);
    preview();
  }
  const expense=document.querySelector('#expenseForm');
  if(expense){
    const payment=document.querySelector('#expensePayment');
    const recurring=document.querySelector('#isRecurring');
    const installments=document.querySelector('#installmentsField');
    const firstBill=document.querySelector('#billDateField');
    const billDateInput=document.querySelector('#FirstBillDate');
    const paidRow=document.querySelector('#paidRow');
    const paidInput=document.querySelector('#isPaid');
    const amountLabel=document.querySelector('#expenseAmountLabel');
    const amountHelp=document.querySelector('#amountHelp');
    const edit=expense.dataset.edit==='true';
    function syncExpense(){
      const p=payment?.value||'Pix',isRecurring=!!recurring?.checked;
      const isInstallment=!edit&&!isRecurring&&(p==='Crédito'||p==='Boleto');
      installments?.classList.toggle('hidden',!isInstallment);
      const showBill=!edit&&p==='Boleto';
      firstBill?.classList.toggle('hidden',!showBill);
      if(billDateInput)billDateInput.required=showBill;
      const future=!edit&&(p==='Crédito'||p==='Boleto');
      paidRow?.classList.toggle('hidden',future);
      if(future&&paidInput)paidInput.checked=false;
      if(amountLabel)amountLabel.textContent=isRecurring?'Valor mensal':isInstallment?(p==='Crédito'?'Valor da parcela':'Valor do boleto'):'Valor';
      if(amountHelp)amountHelp.textContent=isInstallment?'Informe o valor de cada parcela, não o valor total.':isRecurring?'Este valor será utilizado nas ocorrências mensais.':'Valor desta movimentação.';
    }
    payment?.addEventListener('change',syncExpense);recurring?.addEventListener('change',syncExpense);syncExpense();
  }
})();