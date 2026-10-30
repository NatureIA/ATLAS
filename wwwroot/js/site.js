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
  // Reports only: responsive SVG area curves, shared zero baseline and independent flags.
  const performance=document.querySelector('#reportPerformance');
  if(performance){
    const svg=performance.querySelector('#reportAreaSvg');
    const wrapper=performance.querySelector('#reportAreaChart');
    const tooltip=performance.querySelector('#reportAreaTooltip');
    const empty=performance.querySelector('.report-performance-empty');
    const inputs=[...performance.querySelectorAll('.report-performance-flags input[type="checkbox"]')];
    const data=[...performance.querySelectorAll('.report-area-data [data-month]')].map(node=>({
      month:node.dataset.month||'',
      revenue:Number(node.dataset.revenue)||0,
      expense:Number(node.dataset.expense)||0,
      result:Number(node.dataset.result)||0
    }));
    const colors={revenue:'#0e9065',expense:'#90a198',result:'#7152cb',loss:'#c15a69'};
    const labels={revenue:'Faturamento',expense:'Despesas',result:'Resultado'};
    const currency=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
    const compact=new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1});
    const NS='http://www.w3.org/2000/svg';
    const W=960,H=320,L=72,R=20,T=24,B=271;
    const width=W-L-R,height=B-T;
    const x=i=>L+(data.length<=1?width/2:(i*width/(data.length-1)));
    let current=()=>new Set(inputs.filter(input=>input.checked).map(input=>input.value));
    const make=(tag,attrs={},parent=svg)=>{
      const node=document.createElementNS(NS,tag);
      Object.entries(attrs).forEach(([key,value])=>node.setAttribute(key,String(value)));
      parent.appendChild(node);
      return node;
    };
    const label=(x0,y0,message,attrs={})=>{
      const node=make('text',{x:x0,y:y0,...attrs});
      node.textContent=message;
      return node;
    };
    // Bézier segments with horizontal controls avoid oscillation/overshoot.
    const smooth=points=>{
      if(!points.length)return '';
      let d='M '+points[0].x.toFixed(2)+' '+points[0].y.toFixed(2);
      for(let i=1;i<points.length;i++){
        const a=points[i-1],b=points[i],mid=(a.x+b.x)/2;
        d+=' C '+mid.toFixed(2)+' '+a.y.toFixed(2)+' '+mid.toFixed(2)+' '+b.y.toFixed(2)+' '+b.x.toFixed(2)+' '+b.y.toFixed(2);
      }
      return d;
    };
    const addGradient=(defs,id,color,reverse=false)=>{
      const gradient=make('linearGradient',{id,x1:'0',y1:'0',x2:'0',y2:'1'},defs);
      make('stop',{offset:'0%','stop-color':color,'stop-opacity':reverse?'0.04':'0.23'},gradient);
      make('stop',{offset:'100%','stop-color':color,'stop-opacity':reverse?'0.22':'0.015'},gradient);
    };
    const placeTooltip=(index,active)=>{
      if(!tooltip||!data[index])return;
      tooltip.replaceChildren();
      const heading=document.createElement('strong');
      heading.textContent=data[index].month;
      tooltip.appendChild(heading);
      ['revenue','expense','result'].filter(key=>active.has(key)).forEach(key=>{
        const line=document.createElement('div');
        line.className='report-area-tooltip-row';
        const dot=document.createElement('span');
        dot.className='report-area-tooltip-dot';
        dot.style.background=key==='result'&&data[index].result<0?colors.loss:colors[key];
        const name=document.createElement('span');name.textContent=labels[key];
        const amount=document.createElement('b');amount.textContent=currency.format(data[index][key]);
        line.append(dot,name,amount);
        tooltip.appendChild(line);
      });
      tooltip.style.left=Math.min(83,Math.max(17,x(index)/W*100))+'%';
      tooltip.classList.add('visible');
      tooltip.setAttribute('aria-hidden','false');
    };
    function drawPerformance(){
      const active=current();
      svg.replaceChildren();
      svg.setAttribute('viewBox','0 0 '+W+' '+H);
      wrapper.hidden=active.size===0;
      empty?.classList.toggle('hidden',active.size!==0);
      if(!active.size||!data.length)return;
      const values=data.flatMap(point=>[0,...[...active].map(key=>point[key])]);
      const high=Math.max(0,...values),low=Math.min(0,...values);
      const ymax=high>0?high*1.12:(low===0?1:0);
      const ymin=low<0?low*1.18:0;
      const range=ymax-ymin||1;
      const y=value=>B-(value-ymin)/range*height;
      const baseline=y(0);
      const defs=make('defs');
      addGradient(defs,'atlasAreaRevenue',colors.revenue);
      addGradient(defs,'atlasAreaExpense',colors.expense);
      addGradient(defs,'atlasAreaResult',colors.result);
      addGradient(defs,'atlasAreaLoss',colors.loss,true);
      const posClip=make('clipPath',{id:'atlasAreaAbove'},defs);
      make('rect',{x:L-5,y:T-4,width:width+10,height:Math.max(0,baseline-T+4)},posClip);
      const negClip=make('clipPath',{id:'atlasAreaBelow'},defs);
      make('rect',{x:L-5,y:baseline,width:width+10,height:Math.max(0,B-baseline+5)},negClip);
      for(let tick=0;tick<=4;tick++){
        const value=ymin+(range*tick/4);
        const py=y(value);
        make('line',{x1:L,y1:py,x2:W-R,y2:py,stroke:'#e7ece8','stroke-width':'1','stroke-dasharray':'3 5'});
        label(L-12,py+4,compact.format(value),{'text-anchor':'end','font-size':'12',fill:'#88998d'});
      }
      make('line',{x1:L,y1:baseline,x2:W-R,y2:baseline,stroke:'#b8c5ba','stroke-width':'1.3'});
      data.forEach((point,i)=>{
        label(x(i),H-18,point.month,{'text-anchor':'middle','font-size':'12',fill:'#88998d'});
      });
      const ordered=['expense','revenue','result'];
      ordered.filter(key=>active.has(key)).forEach(key=>{
        const points=data.map((row,i)=>({x:x(i),y:y(row[key])}));
        const line=smooth(points);
        const baseArea=line+' L '+points[points.length-1].x.toFixed(2)+' '+baseline.toFixed(2)+' L '+points[0].x.toFixed(2)+' '+baseline.toFixed(2)+' Z';
        const draw=(gradient,stroke,clipId)=>{
          const attrs=clipId?{'clip-path':'url(#'+clipId+')'}:{};
          make('path',{d:baseArea,fill:'url(#'+gradient+')',...attrs});
          make('path',{d:line,fill:'none',stroke,'stroke-width':'3','stroke-linecap':'round','stroke-linejoin':'round',...attrs});
        };
        if(key==='result'){
          draw('atlasAreaResult',colors.result,'atlasAreaAbove');
          draw('atlasAreaLoss',colors.loss,'atlasAreaBelow');
        }else draw(key==='revenue'?'atlasAreaRevenue':'atlasAreaExpense',colors[key]);
      });
      // A single focus/hover guide reveals exact values without 36 permanent dots.
      const guide=make('line',{x1:L,y1:T,x2:L,y2:B,stroke:'#a0b0a5','stroke-width':'1.1','stroke-dasharray':'4 4',visibility:'hidden'});
      const dots={};
      ['revenue','expense','result'].filter(key=>active.has(key)).forEach(key=>{
        dots[key]=make('circle',{cx:L,cy:baseline,r:4,fill:'#fff',stroke:colors[key],'stroke-width':'2.8',visibility:'hidden'});
      });
      function hover(index){
        const i=Math.max(0,Math.min(data.length-1,index));
        const xx=x(i);
        guide.setAttribute('x1',xx);guide.setAttribute('x2',xx);guide.setAttribute('visibility','visible');
        Object.entries(dots).forEach(([key,node])=>{
          node.setAttribute('cx',xx);node.setAttribute('cy',y(data[i][key]));
          node.setAttribute('stroke',key==='result'&&data[i].result<0?colors.loss:colors[key]);
          node.setAttribute('visibility','visible');
        });
        placeTooltip(i,active);
      }
      function hide(){
        guide.setAttribute('visibility','hidden');
        Object.values(dots).forEach(node=>node.setAttribute('visibility','hidden'));
        tooltip?.classList.remove('visible');
        tooltip?.setAttribute('aria-hidden','true');
      }
      svg.onpointermove=event=>{
        const rect=svg.getBoundingClientRect();
        const rawX=(event.clientX-rect.left)/rect.width*W;
        hover(data.length===1?0:Math.round((rawX-L)/width*(data.length-1)));
      };
      svg.onpointerdown=svg.onpointermove;
      svg.onpointerleave=hide;
      data.forEach((point,i)=>{
        const hit=make('circle',{cx:x(i),cy:baseline,r:10,fill:'transparent',tabindex:'0','aria-label':point.month+': '+[...active].map(key=>labels[key]+' '+currency.format(point[key])).join(', ')});
        hit.addEventListener('focus',()=>hover(i));
        hit.addEventListener('blur',hide);
      });
    }
    inputs.forEach(input=>input.addEventListener('change',drawPerformance));
    drawPerformance();
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