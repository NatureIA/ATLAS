const A=document.querySelector('#app'),
now=()=>String(new Date().getMonth()+1).padStart(2,'0')+'/'+new Date().getFullYear();

let me=null;
let cad=[];
let vigenciaAtual=now();
let lancamentosAtuais=[];
let modalAtual=null;

async function api(u,o={}){
    const r=await fetch(u,{
        ...o,
        headers:{
            'Content-Type':'application/json',
            ...(o.headers||{})
        }
    });

    const x=await r.json().catch(()=>({}));

    if(!r.ok){
        throw Error(x.error||'Erro no ATLAS');
    }

    return x;
}

function err(e){
    return `<div class="error">${e.message||e}</div>`;
}

function mudarVigencia(v,delta){
    const [m,a]=v.split('/').map(Number);
    const d=new Date(a,m-1+delta,1);

    return String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear();
}

function valorBRL(v){
    return Number(v||0).toLocaleString('pt-BR',{
        style:'currency',
        currency:'BRL'
    });
}

function escapeHtml(v){
    return String(v??'')
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;')
        .replace(/'/g,'&#039;');
}

function nomeCadastro(id){
    return cad.find(x=>String(x.Id)===String(id))?.Nome||'';
}

function opts(g,selecionado=''){
    return `<option value="">Selecione</option>`+
        cad
        .filter(x=>+x.Grupo===g)
        .map(x=>`
            <option
                value="${x.Id}"
                ${String(x.Id)===String(selecionado)?'selected':''}
            >
                ${escapeHtml(x.Nome)}
            </option>
        `)
        .join('')+
        `<option value="new">+ Criar novo</option>`;
}

function tipoLancamento(x){
    const modo=String(x.ComoSeraPago||'').toLowerCase();

    if(modo==='recorrente'){
        return 'RECORRENTE';
    }

    if(x.ParcelaAtual&&x.TotalParcelas){
        return 'PARCELADO';
    }

    return 'UNICO';
}

function instalarModal(){
    if(document.querySelector('#atlasModalRoot')){
        return;
    }

    const root=document.createElement('div');

    root.id='atlasModalRoot';

    document.body.appendChild(root);

    const style=document.createElement('style');

    style.id='atlasModalStyles';

    style.textContent=`
        .atlas-modal-overlay{
            position:fixed;
            inset:0;
            z-index:9999;
            display:flex;
            align-items:center;
            justify-content:center;
            padding:24px;
            background:rgba(0,0,0,.78);
            backdrop-filter:blur(8px);
        }

        .atlas-modal{
            width:min(680px,100%);
            max-height:90vh;
            overflow:auto;
            background:#080b12;
            border:1px solid rgba(255,255,255,.09);
            border-radius:20px;
            box-shadow:
                0 30px 80px rgba(0,0,0,.65),
                0 0 0 1px rgba(123,48,255,.05);
        }

        .atlas-modal-head{
            display:flex;
            align-items:flex-start;
            justify-content:space-between;
            gap:20px;
            padding:26px 28px 20px;
            border-bottom:1px solid rgba(255,255,255,.07);
        }

        .atlas-modal-head h2{
            margin:0 0 7px;
            font-size:22px;
            color:#fff;
        }

        .atlas-modal-head p{
            margin:0;
            color:#8d94a3;
            font-size:14px;
            line-height:1.5;
        }

        .atlas-modal-close{
            width:38px;
            height:38px;
            flex:none;
            padding:0;
            border:1px solid rgba(255,255,255,.08);
            border-radius:10px;
            background:#10141d;
            color:#aab0bd;
            font-size:22px;
            cursor:pointer;
        }

        .atlas-modal-close:hover{
            color:#fff;
            border-color:rgba(255,255,255,.18);
        }

        .atlas-modal-body{
            padding:26px 28px;
        }

        .atlas-modal-item{
            padding:17px 18px;
            margin-bottom:20px;
            background:#0d111a;
            border:1px solid rgba(255,255,255,.07);
            border-radius:14px;
        }

        .atlas-modal-item strong{
            display:block;
            margin-bottom:5px;
            color:#fff;
            font-size:16px;
        }

        .atlas-modal-item span{
            color:#969dab;
            font-size:14px;
        }

        .atlas-modal-grid{
            display:grid;
            grid-template-columns:1fr 1fr;
            gap:16px;
        }

        .atlas-modal-grid label{
            display:flex;
            flex-direction:column;
            gap:8px;
            color:#a5abba;
            font-size:13px;
        }

        .atlas-modal-grid .atlas-full{
            grid-column:1/-1;
        }

        .atlas-modal input,
        .atlas-modal select{
            width:100%;
            box-sizing:border-box;
            padding:12px 13px;
            border:1px solid rgba(255,255,255,.09);
            border-radius:10px;
            outline:none;
            background:#070a10;
            color:#fff;
        }

        .atlas-modal input:focus,
        .atlas-modal select:focus{
            border-color:#7438df;
            box-shadow:0 0 0 3px rgba(116,56,223,.12);
        }

        .atlas-scope-title{
            margin:0 0 12px;
            color:#fff;
            font-size:14px;
            font-weight:600;
        }

        .atlas-scope{
            display:grid;
            gap:10px;
        }

        .atlas-scope-option{
            display:flex;
            align-items:flex-start;
            gap:13px;
            padding:15px;
            border:1px solid rgba(255,255,255,.08);
            border-radius:12px;
            background:#0c1018;
            cursor:pointer;
            transition:.15s ease;
        }

        .atlas-scope-option:hover{
            border-color:rgba(124,58,237,.6);
            background:#101421;
        }

        .atlas-scope-option.selected{
            border-color:#7c3aed;
            background:rgba(124,58,237,.10);
            box-shadow:0 0 0 1px rgba(124,58,237,.15);
        }

        .atlas-scope-option input{
            width:auto;
            margin-top:3px;
        }

        .atlas-scope-copy{
            flex:1;
        }

        .atlas-scope-copy strong{
            display:block;
            margin-bottom:4px;
            color:#fff;
            font-size:14px;
        }

        .atlas-scope-copy span{
            display:block;
            color:#8e96a5;
            font-size:13px;
            line-height:1.45;
        }

        .atlas-modal-message{
            display:none;
            margin-top:18px;
            padding:12px 14px;
            border-radius:10px;
            font-size:13px;
            line-height:1.5;
        }

        .atlas-modal-message.error{
            display:block;
            background:rgba(220,38,38,.10);
            border:1px solid rgba(220,38,38,.30);
            color:#fca5a5;
        }

        .atlas-modal-message.success{
            display:block;
            background:rgba(22,163,74,.10);
            border:1px solid rgba(22,163,74,.30);
            color:#86efac;
        }

        .atlas-modal-footer{
            display:flex;
            justify-content:flex-end;
            gap:10px;
            padding:20px 28px 26px;
            border-top:1px solid rgba(255,255,255,.07);
        }

        .atlas-btn-secondary{
            padding:11px 18px;
            border:1px solid rgba(255,255,255,.10);
            border-radius:10px;
            background:#111620;
            color:#c5cad4;
            cursor:pointer;
        }

        .atlas-btn-primary{
            padding:11px 18px;
            border:0;
            border-radius:10px;
            background:linear-gradient(135deg,#7c3aed,#4f46e5);
            color:#fff;
            font-weight:600;
            cursor:pointer;
        }

        .atlas-btn-danger{
            padding:11px 18px;
            border:1px solid rgba(239,68,68,.35);
            border-radius:10px;
            background:rgba(220,38,38,.14);
            color:#fca5a5;
            font-weight:600;
            cursor:pointer;
        }

        .atlas-btn-primary:disabled,
        .atlas-btn-danger:disabled{
            opacity:.5;
            cursor:not-allowed;
        }

        .atlas-danger-box{
            margin-top:18px;
            padding:14px 16px;
            border:1px solid rgba(239,68,68,.20);
            border-radius:12px;
            background:rgba(220,38,38,.07);
            color:#c8cdd6;
            font-size:13px;
            line-height:1.55;
        }

        .atlas-action-btn{
            padding:8px 13px;
            border:1px solid rgba(255,255,255,.08);
            border-radius:9px;
            cursor:pointer;
        }

        .atlas-action-edit{
            background:rgba(124,58,237,.18);
            color:#b99cff;
        }

        .atlas-action-delete{
            background:rgba(220,38,38,.10);
            color:#f39a9a;
        }

        @media(max-width:650px){
            .atlas-modal-overlay{
                padding:12px;
                align-items:flex-end;
            }

            .atlas-modal{
                border-radius:18px 18px 12px 12px;
                max-height:94vh;
            }

            .atlas-modal-grid{
                grid-template-columns:1fr;
            }

            .atlas-modal-grid .atlas-full{
                grid-column:auto;
            }

            .atlas-modal-head,
            .atlas-modal-body,
            .atlas-modal-footer{
                padding-left:18px;
                padding-right:18px;
            }

            .atlas-modal-footer{
                flex-direction:column-reverse;
            }

            .atlas-modal-footer button{
                width:100%;
            }
        }
    `;

    document.head.appendChild(style);
}

function fecharModal(){
    const root=document.querySelector('#atlasModalRoot');

    if(root){
        root.innerHTML='';
    }

    modalAtual=null;
}

function abrirModal(html){
    instalarModal();

    const root=document.querySelector('#atlasModalRoot');

    root.innerHTML=`
        <div class="atlas-modal-overlay" id="atlasModalOverlay">
            ${html}
        </div>
    `;

    document.querySelector('#atlasModalOverlay').onclick=e=>{
        if(e.target.id==='atlasModalOverlay'){
            fecharModal();
        }
    };
}

function mensagemModal(texto,tipo='error'){
    const e=document.querySelector('#atlasModalMessage');

    if(!e){
        return;
    }

    e.className='atlas-modal-message '+tipo;
    e.textContent=texto;
}

function selecionarEscopoVisual(){
    document.querySelectorAll('.atlas-scope-option').forEach(el=>{
        const radio=el.querySelector('input[type=radio]');

        el.classList.toggle(
            'selected',
            !!radio?.checked
        );
    });
}

async function start(){
    try{
        const s=await api('/api/setup/status');

        if(s.required){
            return setup();
        }

        me=await api('/api/me');

        shell();
        dashboard();

    }catch{
        login();
    }
}

function setup(){
    A.innerHTML=`
        <main class="login">
            <form class="card" id="f">
                <h1>ATLAS</h1>
                <p class="muted">Configuração inicial do administrador</p>

                <div id="e"></div>

                <label>
                    Nome
                    <input name="nome" required>
                </label>

                <label>
                    E-mail
                    <input name="email" type="email" required>
                </label>

                <label>
                    Senha inicial
                    <input name="senha" type="password" minlength="10" required>
                </label>

                <button>Criar administrador</button>
            </form>
        </main>
    `;

    f.onsubmit=async e=>{
        e.preventDefault();

        try{
            await api('/api/setup',{
                method:'POST',
                body:JSON.stringify(
                    Object.fromEntries(
                        new FormData(f)
                    )
                )
            });

            login();

        }catch(x){
            document.querySelector('#e').innerHTML=err(x);
        }
    };
}

function login(){
    A.innerHTML=`
        <main class="login">
            <form class="card" id="f">
                <h1>ATLAS</h1>
                <p class="muted">Acesso ao sistema financeiro</p>

                <div id="e"></div>

                <label>
                    E-mail
                    <input name="email" type="email" required>
                </label>

                <label>
                    Senha
                    <input name="senha" type="password" required>
                </label>

                <button>Entrar</button>
            </form>
        </main>
    `;

    f.onsubmit=async e=>{
        e.preventDefault();

        try{
            await api('/api/login',{
                method:'POST',
                body:JSON.stringify(
                    Object.fromEntries(
                        new FormData(f)
                    )
                )
            });

            me=await api('/api/me');

            shell();
            dashboard();

        }catch(x){
            document.querySelector('#e').innerHTML=err(x);
        }
    };
}

function shell(){
    A.innerHTML=`
        <div class="shell">
            <header class="top">
                <div class="brand">ATLAS</div>

                <div class="nav">
                    <button onclick="dashboard()">Dashboard</button>
                    <button onclick="lancamentos()">Lançamentos</button>
                    <button onclick="logout()">Sair</button>
                </div>
            </header>

            <main class="wrap" id="view"></main>
        </div>
    `;
}

async function logout(){
    await api('/api/logout',{
        method:'POST'
    });

    login();
}

async function dashboard(v=vigenciaAtual){
    vigenciaAtual=v;

    const d=await api(
        '/api/dashboard?vigencia='+
        encodeURIComponent(v)
    );

    view.innerHTML=`
        <div class="head">
            <div>
                <h1>Dashboard</h1>

                <div style="display:flex;align-items:center;gap:12px;margin-top:8px">
                    <button
                        type="button"
                        onclick="dashboard(mudarVigencia(vigenciaAtual,-1))"
                    >
                        ←
                    </button>

                    <strong>${v}</strong>

                    <button
                        type="button"
                        onclick="dashboard(mudarVigencia(vigenciaAtual,1))"
                    >
                        →
                    </button>

                    ${
                        v!==now()
                        ?`<button type="button" onclick="dashboard(now())">Mês atual</button>`
                        :''
                    }
                </div>
            </div>

            <button onclick="lancamentos(vigenciaAtual)">
                Novo lançamento
            </button>
        </div>

<section class="atlas-financial-overview">

    <article class="atlas-balance-card">
        <div class="atlas-balance-top">
            <div>
                <span class="atlas-eyebrow">POSIÇÃO FINANCEIRA</span>
                <h2>Saldo do mês</h2>
            </div>

            <span class="atlas-period">${v}</span>
        </div>

        <strong class="atlas-balance-value ${Number(d.Saldo||0)<0?'negative':''}">
            ${valorBRL(d.Saldo)}
        </strong>

        <div class="atlas-balance-footer">
            <span>
                ${d.Quantidade||0}
                ${Number(d.Quantidade||0)===1?'lançamento':'lançamentos'} no período
            </span>
        </div>
    </article>

    <div class="atlas-metrics-grid">

        <article class="atlas-metric-card atlas-metric-income">
            <div class="atlas-metric-head">
                <span>Receitas</span>
                <span class="atlas-metric-indicator">+</span>
            </div>

            <strong>${valorBRL(d.Receitas)}</strong>
            <small>Entradas do período</small>
        </article>

        <article class="atlas-metric-card atlas-metric-expense">
            <div class="atlas-metric-head">
                <span>Despesas</span>
                <span class="atlas-metric-indicator">−</span>
            </div>

            <strong>${valorBRL(d.Despesas)}</strong>
            <small>Saídas do período</small>
        </article>

        <article class="atlas-metric-card atlas-metric-saving">
            <div class="atlas-metric-head">
                <span>Economia</span>
                <span class="atlas-metric-indicator">↗</span>
            </div>

            <strong>${valorBRL(d.Economia)}</strong>
            <small>Valor destinado à economia</small>
        </article>

    </div>

</section>

<section class="atlas-dashboard-details">

    <article class="atlas-detail-card">
        <div class="atlas-detail-head">
            <div>
                <span class="atlas-eyebrow">DESPESAS</span>
                <h2>Distribuição por categoria</h2>
            </div>

            <span class="atlas-detail-total">
                ${valorBRL(Math.abs(Number(d.Despesas||0)))}
            </span>
        </div>

        <div class="atlas-category-list">
            ${
                (d.CategoriasDespesas||[]).length
                ?d.CategoriasDespesas.map(x=>{

                    const total=Math.abs(Number(d.Despesas||0));
                    const valor=Math.abs(Number(x.Valor||0));

                    const percentual=
                        total>0
                        ?Math.min(100,(valor/total)*100)
                        :0;

                    return `
                        <div class="atlas-category-item">

                            <div class="atlas-category-info">
                                <div>
                                    <strong>${escapeHtml(x.Categoria)}</strong>
                                    <span>${percentual.toFixed(1).replace('.',',')}%</span>
                                </div>

                                <strong>${valorBRL(valor)}</strong>
                            </div>

                            <div class="atlas-category-track">
                                <div
                                    class="atlas-category-bar"
                                    style="width:${percentual}%"
                                ></div>
                            </div>

                        </div>
                    `;
                }).join('')
                :`
                    <div class="atlas-empty-state">
                        Nenhuma despesa registrada neste período.
                    </div>
                `
            }
        </div>
    </article>

</section>

    `;
}

async function loadCad(){
    cad=await api('/api/cadastros');
}

async function lancamentos(v=vigenciaAtual){
    vigenciaAtual=v;

    await loadCad();

    const ls=await api(
        '/api/lancamentos?vigencia='+
        encodeURIComponent(v)
    );

    lancamentosAtuais=ls;

    view.innerHTML=`
        <div class="head">
            <div>
                <h1>Lançamentos</h1>

                <div style="display:flex;align-items:center;gap:12px;margin-top:8px">
                    <button
                        type="button"
                        onclick="lancamentos(mudarVigencia(vigenciaAtual,-1))"
                    >
                        ←
                    </button>

                    <strong>${v}</strong>

                    <button
                        type="button"
                        onclick="lancamentos(mudarVigencia(vigenciaAtual,1))"
                    >
                        →
                    </button>

                    ${
                        v!==now()
                        ?`<button type="button" onclick="lancamentos(now())">Mês atual</button>`
                        :''
                    }
                </div>
            </div>
        </div>

        <section class="card">
            <form id="lf">
                <div id="le"></div>

                <div class="form-grid">
                    <label>
                        Tipo
                        <select name="tipoId" data-g="1">
                            ${opts(1)}
                        </select>
                    </label>

                    <label>
                        Categoria
                        <select name="categoriaId" data-g="2">
                            ${opts(2)}
                        </select>
                    </label>

                    <label>
                        Forma de pagamento
                        <select name="formaPagamentoId" data-g="3">
                            ${opts(3)}
                        </select>
                    </label>

                    <label>
                        Como será pago
                        <select name="comoSeraPagoId" data-g="4">
                            ${opts(4)}
                        </select>
                    </label>

                    <label>
                        Descrição
                        <input name="descricao" required>
                    </label>

                    <label>
                        Valor total
                        <input
                            name="valor"
                            type="number"
                            min=".01"
                            step=".01"
                            required
                        >
                    </label>

                    <label>
                        Vigência
                        <input
                            name="vigencia"
                            value="${v}"
                            required
                        >
                    </label>

                    <label id="pb" style="display:none">
                        Quantidade de parcelas
                        <input
                            name="quantidadeParcelas"
                            type="number"
                            min="2"
                        >
                    </label>
                </div>

                <button>Salvar lançamento</button>
            </form>
        </section>

        <section class="card">
            <table>
                <thead>
                    <tr>
                        <th>Descrição</th>
                        <th>Tipo</th>
                        <th>Categoria</th>
                        <th>Valor</th>
                        <th>Parcela</th>
                        <th>Ações</th>
                    </tr>
                </thead>

                <tbody>
                    ${
                        ls.map((x,i)=>`
                            <tr>
                                <td>${escapeHtml(x.Descricao)}</td>
                                <td>${escapeHtml(x.Tipo)}</td>
                                <td>${escapeHtml(x.Categoria)}</td>
                                <td>${valorBRL(x.Valor)}</td>

                                <td>
                                    ${
                                        x.ParcelaAtual
                                        ?x.ParcelaAtual+'/'+x.TotalParcelas
                                        :(
                                            String(x.ComoSeraPago||'').toLowerCase()==='recorrente'
                                            ?'Recorrente'
                                            :'—'
                                        )
                                    }
                                </td>

                                <td>
                                    <div style="display:flex;gap:7px;flex-wrap:wrap">
                                        <button
                                            class="atlas-action-btn atlas-action-edit"
                                            type="button"
                                            onclick="editarLancamento(${i})"
                                        >
                                            Editar
                                        </button>

                                        <button
                                            class="atlas-action-btn atlas-action-delete"
                                            type="button"
                                            onclick="excluirLancamento(${i})"
                                        >
                                            Excluir
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        `).join('')
                        ||
                        '<tr><td colspan="6">Nenhum lançamento.</td></tr>'
                    }
                </tbody>
            </table>
        </section>
    `;

    configurarCadastros();

    lf.onsubmit=async e=>{
        e.preventDefault();


const btnSalvar=lf.querySelector('button[type="submit"], button:not([type])');

if(btnSalvar.disabled){
    return;
}

btnSalvar.disabled=true;
btnSalvar.textContent='Salvando...';



        try{
            const b=Object.fromEntries(
                new FormData(lf)
            );

            await api('/api/lancamentos',{
                method:'POST',
                body:JSON.stringify(b)
            });

            vigenciaAtual=b.vigencia;

            lancamentos(vigenciaAtual);

}catch(x){
    le.innerHTML=err(x);
    btnSalvar.disabled=false;
    btnSalvar.textContent='Salvar lançamento';
}


    };

    toggle();
}

function configurarCadastros(){
    document
    .querySelectorAll('select[data-g]')
    .forEach(s=>{
        s.onchange=()=>{
            if(s.value==='new'){
                abrirNovoCadastro(s);
                return;
            }

            toggle();
        };
    });
}

function abrirNovoCadastro(select){
    const grupo=+select.dataset.g;

    abrirModal(`
        <div class="atlas-modal">
            <div class="atlas-modal-head">
                <div>
                    <h2>Nova opção</h2>
                    <p>Adicione uma nova opção ao seu cadastro financeiro.</p>
                </div>

                <button
                    type="button"
                    class="atlas-modal-close"
                    onclick="fecharModal()"
                >
                    ×
                </button>
            </div>

            <div class="atlas-modal-body">
                <label style="display:flex;flex-direction:column;gap:8px;color:#a5abba;font-size:13px">
                    Nome
                    <input
                        id="novoCadastroNome"
                        maxlength="100"
                        autocomplete="off"
                    >
                </label>

                <div
                    id="atlasModalMessage"
                    class="atlas-modal-message"
                ></div>
            </div>

            <div class="atlas-modal-footer">
                <button
                    type="button"
                    class="atlas-btn-secondary"
                    onclick="cancelarNovoCadastro()"
                >
                    Cancelar
                </button>

                <button
                    type="button"
                    class="atlas-btn-primary"
                    onclick="salvarNovoCadastro(${grupo})"
                >
                    Criar opção
                </button>
            </div>
        </div>
    `);

    modalAtual={
        tipo:'NOVO_CADASTRO',
        select
    };

    setTimeout(()=>{
        document.querySelector('#novoCadastroNome')?.focus();
    },0);
}

function cancelarNovoCadastro(){
    if(modalAtual?.select){
        modalAtual.select.value='';
    }

    fecharModal();
}

async function salvarNovoCadastro(grupo){
    const input=document.querySelector('#novoCadastroNome');
    const nome=String(input?.value||'').trim();


const btnCriar=document.querySelector('.atlas-modal-footer .atlas-btn-primary');

if(btnCriar?.disabled){
    return;
}

if(btnCriar){
    btnCriar.disabled=true;
    btnCriar.textContent='Criando...';
}



    if(!nome){
        mensagemModal('Informe o nome da nova opção.');
        return;
    }

const normalizarNome=v=>
    String(v||'')
        .replace(/\s+/g,' ')
        .trim()
        .toLowerCase();

const duplicado=cad.some(x=>
    +x.Grupo===+grupo &&
    normalizarNome(x.Nome)===normalizarNome(nome)
);

if(duplicado){
    mensagemModal('Essa opção já existe.');

    if(btnCriar){
        btnCriar.disabled=false;
        btnCriar.textContent='Criar opção';
    }

    return;
}



    try{
        const x=await api('/api/cadastros',{
            method:'POST',
            body:JSON.stringify({
                grupo,
                nome
            })
        });

        const select=modalAtual?.select;

        if(select){
            const o=new Option(
                x.Nome,
                x.Id
            );

            select.add(
                o,
                select.options.length-1
            );

            select.value=x.Id;
        }

        cad=await api('/api/cadastros');

        fecharModal();
        toggle();

    }catch(e){
        mensagemModal(e.message);

        if(btnCriar){
            btnCriar.disabled=false;
            btnCriar.textContent='Criar opção';
        }
    }
}

function blocoEscopo(x,acao){
    const tipo=tipoLancamento(x);

    if(tipo==='UNICO'){
        return '';
    }

    if(tipo==='PARCELADO'){
        if(acao==='EDITAR'){
            return `
                <div style="margin-top:22px">
                    <p class="atlas-scope-title">
                        Onde aplicar esta alteração?
                    </p>

                    <div class="atlas-scope">
                        <label class="atlas-scope-option selected">
                            <input
                                type="radio"
                                name="escopo"
                                value="UNICO"
                                checked
                                onchange="selecionarEscopoVisual()"
                            >

                            <span class="atlas-scope-copy">
                                <strong>Somente esta parcela</strong>
                                <span>
                                    Altera apenas a parcela exibida em ${vigenciaAtual}.
                                    As demais parcelas permanecem como estão.
                                </span>
                            </span>
                        </label>

                        <label class="atlas-scope-option">
                            <input
                                type="radio"
                                name="escopo"
                                value="PROXIMOS"
                                onchange="selecionarEscopoVisual()"
                            >

                            <span class="atlas-scope-copy">
                                <strong>Esta parcela e as próximas</strong>
                                <span>
                                    Aplica a alteração nesta parcela e em todas
                                    as parcelas posteriores.
                                </span>
                            </span>
                        </label>
                    </div>
                </div>
            `;
        }

        return `
            <div style="margin-top:22px">
                <p class="atlas-scope-title">
                    O que deseja excluir?
                </p>

                <div class="atlas-scope">
                    <label class="atlas-scope-option selected">
                        <input
                            type="radio"
                            name="escopo"
                            value="UNICO"
                            checked
                            onchange="selecionarEscopoVisual()"
                        >

                        <span class="atlas-scope-copy">
                            <strong>Somente esta parcela</strong>
                            <span>
                                Remove apenas a parcela ${x.ParcelaAtual}/${x.TotalParcelas}.
                                As demais parcelas continuam normalmente.
                            </span>
                        </span>
                    </label>

                    <label class="atlas-scope-option">
                        <input
                            type="radio"
                            name="escopo"
                            value="PROXIMOS"
                            onchange="selecionarEscopoVisual()"
                        >

                        <span class="atlas-scope-copy">
                            <strong>Esta parcela e as próximas</strong>
                            <span>
                                Remove esta parcela e todas as parcelas
                                posteriores desta compra.
                            </span>
                        </span>
                    </label>
                </div>
            </div>
        `;
    }

    if(acao==='EDITAR'){
        return `
            <div style="margin-top:22px">
                <p class="atlas-scope-title">
                    Onde aplicar esta alteração?
                </p>

                <div class="atlas-scope">
                    <label class="atlas-scope-option selected">
                        <input
                            type="radio"
                            name="escopo"
                            value="UNICO"
                            checked
                            onchange="selecionarEscopoVisual()"
                        >

                        <span class="atlas-scope-copy">
                            <strong>Somente ${vigenciaAtual}</strong>
                            <span>
                                Altera apenas este mês. Os próximos meses
                                continuam com os dados atuais da recorrência.
                            </span>
                        </span>
                    </label>

                    <label class="atlas-scope-option">
                        <input
                            type="radio"
                            name="escopo"
                            value="PROXIMOS"
                            onchange="selecionarEscopoVisual()"
                        >

                        <span class="atlas-scope-copy">
                            <strong>${vigenciaAtual} e os próximos meses</strong>
                            <span>
                                A alteração passa a valer neste mês e permanece
                                nos próximos lançamentos da recorrência.
                            </span>
                        </span>
                    </label>
                </div>
            </div>
        `;
    }

    return `
        <div style="margin-top:22px">
            <p class="atlas-scope-title">
                O que deseja fazer?
            </p>

            <div class="atlas-scope">
                <label class="atlas-scope-option selected">
                    <input
                        type="radio"
                        name="escopo"
                        value="UNICO"
                        checked
                        onchange="selecionarEscopoVisual()"
                    >

                    <span class="atlas-scope-copy">
                        <strong>Excluir somente ${vigenciaAtual}</strong>
                        <span>
                            Remove somente este mês. A recorrência continuará
                            normalmente nos meses seguintes.
                        </span>
                    </span>
                </label>

                <label class="atlas-scope-option">
                    <input
                        type="radio"
                        name="escopo"
                        value="PROXIMOS"
                        onchange="selecionarEscopoVisual()"
                    >

                    <span class="atlas-scope-copy">
                        <strong>Cancelar a partir de ${vigenciaAtual}</strong>
                        <span>
                            Remove este mês e encerra todos os próximos
                            lançamentos desta recorrência.
                        </span>
                    </span>
                </label>
            </div>
        </div>
    `;
}

function editarLancamento(i){
    const x=lancamentosAtuais[i];

    if(!x){
        return;
    }

    modalAtual={
        tipo:'EDITAR',
        indice:i,
        lancamento:x
    };

    abrirModal(`
        <div class="atlas-modal">
            <div class="atlas-modal-head">
                <div>
                    <h2>Editar lançamento</h2>
                    <p>
                        Revise as informações antes de salvar a alteração.
                    </p>
                </div>

                <button
                    type="button"
                    class="atlas-modal-close"
                    onclick="fecharModal()"
                >
                    ×
                </button>
            </div>

            <form id="atlasEditForm">
                <div class="atlas-modal-body">

                    <div class="atlas-modal-item">
                        <strong>${escapeHtml(x.Descricao)}</strong>
                        <span>
                            ${vigenciaAtual} · ${valorBRL(x.Valor)}
                        </span>
                    </div>

                    <div class="atlas-modal-grid">
                        <label>
                            Tipo
                            <select name="tipoId" required>
                                ${opts(1,x.TipoId)}
                            </select>
                        </label>

                        <label>
                            Categoria
                            <select name="categoriaId" required>
                                ${opts(2,x.CategoriaId)}
                            </select>
                        </label>

                        <label>
                            Forma de pagamento
                            <select name="formaPagamentoId" required>
                                ${opts(3,x.FormaPagamentoId)}
                            </select>
                        </label>

                        <label>
                            Como será pago
                            <select
                                name="comoSeraPagoId"
                                required
                                ${tipoLancamento(x)!=='UNICO'?'disabled':''}
                            >
                                ${opts(4,x.ComoSeraPagoId)}
                            </select>
                        </label>

                        <label class="atlas-full">
                            Descrição
                            <input
                                name="descricao"
                                value="${escapeHtml(x.Descricao)}"
                                maxlength="250"
                                required
                            >
                        </label>

                        <label>
                            Valor
                            <input
                                name="valor"
                                type="number"
                                min=".01"
                                step=".01"
                                value="${Number(x.Valor).toFixed(2)}"
                                required
                            >
                        </label>

                        <label>
                            Vigência
                            <input
                                name="vigencia"
                                value="${vigenciaAtual}"
                                ${tipoLancamento(x)!=='UNICO'?'disabled':''}
                           >
                        </label>
                    </div>

                    ${blocoEscopo(x,'EDITAR')}

                    <div
                        id="atlasModalMessage"
                        class="atlas-modal-message"
                    ></div>
                </div>

                <div class="atlas-modal-footer">
                    <button
                        type="button"
                        class="atlas-btn-secondary"
                        onclick="fecharModal()"
                    >
                        Cancelar
                    </button>

                    <button
                        type="submit"
                        class="atlas-btn-primary"
                        id="atlasSalvarEdicao"
                    >
                        Salvar alteração
                    </button>
                </div>
            </form>
        </div>
    `);

    document.querySelector('#atlasEditForm').onsubmit=salvarEdicao;
}

async function salvarEdicao(e){
    e.preventDefault();

    const x=modalAtual?.lancamento;

    if(!x){
        return;
    }

    const form=e.currentTarget;
    const fd=new FormData(form);

    const descricao=String(fd.get('descricao')||'').trim();
    const valor=Number(fd.get('valor'));

    if(!descricao){
        mensagemModal('Informe a descrição do lançamento.');
        return;
    }

    if(!valor||valor<=0){
        mensagemModal('Informe um valor válido.');
        return;
    }

    const escopo=
        form.querySelector('[name="escopo"]:checked')?.value
        ||
        'UNICO';

    const comoSeraPagoId=
        tipoLancamento(x)!=='UNICO'
        ?x.ComoSeraPagoId
        :fd.get('comoSeraPagoId');

    const btn=document.querySelector('#atlasSalvarEdicao');

    btn.disabled=true;
    btn.textContent='Salvando...';

    try{
        await api('/api/lancamentos/editar',{
            method:'POST',
            body:JSON.stringify({
                id:x.Id,
                tipoId:+fd.get('tipoId'),
                categoriaId:+fd.get('categoriaId'),
                formaPagamentoId:+fd.get('formaPagamentoId'),
                comoSeraPagoId:+comoSeraPagoId,
                descricao,
                valor,
                vigencia:tipoLancamento(x)==='UNICO'
                    ?String(fd.get('vigencia')||vigenciaAtual).trim()
                    :vigenciaAtual,
                escopo
            })
        });

        fecharModal();

        await lancamentos(vigenciaAtual);

    }catch(e){
        mensagemModal(e.message);

        btn.disabled=false;
        btn.textContent='Salvar alteração';
    }
}

function excluirLancamento(i){
    const x=lancamentosAtuais[i];

    if(!x){
        return;
    }

    modalAtual={
        tipo:'EXCLUIR',
        indice:i,
        lancamento:x
    };

    const tipo=tipoLancamento(x);

    let titulo='Excluir lançamento';
    let descricao='Esta ação removerá o lançamento selecionado.';

    if(tipo==='PARCELADO'){
        titulo='Excluir parcela';
        descricao='Escolha exatamente quais parcelas devem ser removidas.';
    }

    if(tipo==='RECORRENTE'){
        titulo='Cancelar recorrência';
        descricao='Escolha se deseja remover somente este mês ou encerrar a recorrência.';
    }

    abrirModal(`
        <div class="atlas-modal">
            <div class="atlas-modal-head">
                <div>
                    <h2>${titulo}</h2>
                    <p>${descricao}</p>
                </div>

                <button
                    type="button"
                    class="atlas-modal-close"
                    onclick="fecharModal()"
                >
                    ×
                </button>
            </div>

            <div class="atlas-modal-body">

                <div class="atlas-modal-item">
                    <strong>${escapeHtml(x.Descricao)}</strong>
                    <span>
                        ${vigenciaAtual} · ${valorBRL(x.Valor)}
                        ${
                            tipo==='PARCELADO'
                            ?` · Parcela ${x.ParcelaAtual}/${x.TotalParcelas}`
                            :''
                        }
                    </span>
                </div>

                ${blocoEscopo(x,'EXCLUIR')}

                ${
                    tipo==='UNICO'
                    ?`
                        <div class="atlas-danger-box">
                            Este lançamento será removido de
                            <strong>${vigenciaAtual}</strong>.
                            Esta operação não altera outros lançamentos.
                        </div>
                    `
                    :''
                }

                <div
                    id="atlasModalMessage"
                    class="atlas-modal-message"
                ></div>
            </div>

            <div class="atlas-modal-footer">
                <button
                    type="button"
                    class="atlas-btn-secondary"
                    onclick="fecharModal()"
                >
                    Voltar
                </button>

                <button
                    type="button"
                    class="atlas-btn-danger"
                    id="atlasConfirmarExclusao"
                    onclick="confirmarExclusao()"
                >
                    ${
                        tipo==='RECORRENTE'
                        ?'Confirmar'
                        :'Excluir'
                    }
                </button>
            </div>
        </div>
    `);
}

async function confirmarExclusao(){
    const x=modalAtual?.lancamento;

    if(!x){
        return;
    }

    const escopo=
        document.querySelector('[name="escopo"]:checked')?.value
        ||
        'UNICO';

    const btn=document.querySelector('#atlasConfirmarExclusao');

    btn.disabled=true;
    btn.textContent='Processando...';

    try{
        await api('/api/lancamentos/excluir',{
            method:'POST',
            body:JSON.stringify({
                id:x.Id,
                vigencia:vigenciaAtual,
                escopo
            })
        });

        fecharModal();

        await lancamentos(vigenciaAtual);

    }catch(e){
        mensagemModal(e.message);

        btn.disabled=false;
        btn.textContent='Confirmar';
    }
}

function toggle(){
    const s=document.querySelector('[name=comoSeraPagoId]');
    const b=document.querySelector('#pb');

    if(!s||!b){
        return;
    }

    const p=
        s.options[s.selectedIndex]
        ?.text
        .toLowerCase()==='parcelado';

    b.style.display=p?'flex':'none';

    b.querySelector('input').required=p;
}

instalarModal();
start();