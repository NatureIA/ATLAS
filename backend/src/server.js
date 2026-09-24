'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mssql = require('mssql');

const ROOT = path.resolve(__dirname, '../..');
const PUB = path.join(ROOT, 'public');

function env() {
    const p = path.join(ROOT, '.env');

    if (fs.existsSync(p)) {
        for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
            const m = l.match(/^([^#=]+)=(.*)$/);

            if (m && !process.env[m[1].trim()]) {
                process.env[m[1].trim()] = m[2].trim();
            }
        }
    }
}

env();

const PORT = +(process.env.HTTP_PLATFORM_PORT || process.env.PORT || 3000);
const SECRET = process.env.ATLAS_COOKIE_SECRET || 'ALTERE';

/* =========================================================
   BANCO DE DADOS MSSQL
   ========================================================= */

const dbConfig = {
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: 1433,

    options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true
    },

    pool: {
        max: 5,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

let dbPool = null;

async function getPool() {

    if (dbPool && dbPool.connected) {
        return dbPool;
    }

    dbPool = await new mssql.ConnectionPool(dbConfig).connect();

    console.log('ATLAS conectado ao MSSQL.');

    return dbPool;
}

async function sql(q) {

    const pool = await getPool();

    const result = await pool
        .request()
        .query(q);

    return result.recordset || [];
}

async function exec(q) {

    const pool = await getPool();

    const result = await pool
        .request()
        .query(q);

    return Array.isArray(result.rowsAffected)
        ? result.rowsAffected.reduce((a, b) => a + b, 0)
        : 0;
}

/* =========================================================
   UTILITÁRIOS
   ========================================================= */

const esc = s =>
    String(s ?? '').replace(/'/g, "''");

const month = s =>
    /^\d{2}\/\d{4}$/.test(s)
        ? `${s.slice(3)}-${s.slice(0, 2)}-01`
        : null;

/* =========================================================
   SENHAS
   ========================================================= */

function hash(
    p,
    s = crypto.randomBytes(16).toString('hex')
) {

    return (
        s +
        ':' +
        crypto
            .scryptSync(p, s, 64)
            .toString('hex')
    );
}

function verify(p, h) {

    const [s, x] = String(h).split(':');

    if (!s || !x) {
        return false;
    }

    try {

        return crypto.timingSafeEqual(
            Buffer.from(x, 'hex'),
            crypto.scryptSync(p, s, 64)
        );

    } catch {
        return false;
    }
}

/* =========================================================
   AUTENTICAÇÃO
   ========================================================= */

function token(u) {

    const p = Buffer.from(
        JSON.stringify({
            id: u.Id,
            n: u.Nome,
            r: u.Role,
            e: Date.now() + 86400000
        })
    ).toString('base64url');

    const m = crypto
        .createHmac('sha256', SECRET)
        .update(p)
        .digest('base64url');

    return p + '.' + m;
}

function user(req) {

    try {

        const c = (req.headers.cookie || '')
            .match(/(?:^|; )AtlasAuth=([^;]+)/)?.[1];

        if (!c) {
            return null;
        }

        const [p, m] = c.split('.');

        if (!p || !m) {
            return null;
        }

        const z = crypto
            .createHmac('sha256', SECRET)
            .update(p)
            .digest('base64url');

        if (
            !crypto.timingSafeEqual(
                Buffer.from(m),
                Buffer.from(z)
            )
        ) {
            return null;
        }

        const u = JSON.parse(
            Buffer.from(p, 'base64url')
        );

        return u.e > Date.now()
            ? u
            : null;

    } catch {

        return null;
    }
}

/* =========================================================
   HTTP
   ========================================================= */

async function body(req) {

    let b = '';

    for await (const c of req) {

        b += c;

        if (b.length > 1e6) {
            throw Error('Requisição muito grande.');
        }
    }

    return b
        ? JSON.parse(b)
        : {};
}

function send(
    res,
    n,
    x,
    type = 'application/json; charset=utf-8'
) {

    res.writeHead(n, {
        'Content-Type': type,
        'Cache-Control': 'no-store'
    });

    res.end(
        type.startsWith('application/json')
            ? JSON.stringify(x)
            : x
    );
}

/* =========================================================
   INICIALIZAÇÃO DO BANCO
   ========================================================= */

async function init() {

    if (
        !process.env.DB_PASSWORD ||
        process.env.DB_PASSWORD.includes('COLOQUE_')
    ) {
        throw Error(
            'Configure DB_PASSWORD no arquivo .env.'
        );
    }

    await getPool();

    await exec(`
IF OBJECT_ID('dbo.Usuarios') IS NULL
CREATE TABLE dbo.Usuarios(
    Id INT IDENTITY PRIMARY KEY,
    Nome NVARCHAR(120) NOT NULL,
    Email NVARCHAR(180) NOT NULL UNIQUE,
    PasswordHash NVARCHAR(300) NOT NULL,
    Role VARCHAR(20) NOT NULL DEFAULT 'USER',
    Ativo BIT NOT NULL DEFAULT 1,
    CriadoEm DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID('dbo.CadastrosFinanceiros') IS NULL
CREATE TABLE dbo.CadastrosFinanceiros(
    Id INT IDENTITY PRIMARY KEY,
    UsuarioId INT NULL,
    Grupo INT NOT NULL,
    Nome NVARCHAR(100) NOT NULL,
    PadraoSistema BIT NOT NULL DEFAULT 0,
    Ativo BIT NOT NULL DEFAULT 1
);

IF OBJECT_ID('dbo.SeriesFinanceiras') IS NULL
CREATE TABLE dbo.SeriesFinanceiras(
    Id UNIQUEIDENTIFIER PRIMARY KEY,
    UsuarioId INT NOT NULL,
    Regra VARCHAR(30) NOT NULL,
    Quantidade INT NULL,
    VigenciaInicial DATE NOT NULL,
    CanceladaAPartirDe DATE NULL
);

IF OBJECT_ID('dbo.Lancamentos') IS NULL
CREATE TABLE dbo.Lancamentos(
    Id BIGINT IDENTITY PRIMARY KEY,
    UsuarioId INT NOT NULL,
    TipoId INT NOT NULL,
    CategoriaId INT NOT NULL,
    FormaPagamentoId INT NOT NULL,
    ComoSeraPagoId INT NOT NULL,
    Descricao NVARCHAR(250) NOT NULL,
    Valor DECIMAL(18,2) NOT NULL,
    Vigencia DATE NOT NULL,
    SerieId UNIQUEIDENTIFIER NULL,
    ParcelaAtual INT NULL,
    TotalParcelas INT NULL,
    Origem VARCHAR(20) NOT NULL DEFAULT 'PORTAL',
    CriadoEm DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID('dbo.AuditLog') IS NULL
CREATE TABLE dbo.AuditLog(
    Id BIGINT IDENTITY PRIMARY KEY,
    UsuarioId INT NULL,
    Acao NVARCHAR(80) NOT NULL,
    Dados NVARCHAR(MAX) NULL,
    CriadoEm DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
`);

    const c = await sql(`
        SELECT COUNT(*) N
        FROM dbo.CadastrosFinanceiros
    `);

    if (+c[0].N === 0) {

        const defs = [
            [1, 'Receita'],
            [1, 'Despesa'],
            [1, 'Economia'],

            [2, 'Salário'],
            [2, 'Moradia'],
            [2, 'Mercado'],
            [2, 'Alimentação'],
            [2, 'Transporte'],
            [2, 'Saúde'],
            [2, 'Lazer'],

            [3, 'PIX'],
            [3, 'Débito'],
            [3, 'Crédito'],
            [3, 'Dinheiro'],
            [3, 'Boleto'],

            [4, 'À vista'],
            [4, 'Parcelado'],
            [4, 'Débito'],
            [4, 'Recorrente']
        ];

        await exec(
            defs
                .map(
                    ([g, n]) =>
                        `INSERT dbo.CadastrosFinanceiros
                        (Grupo,Nome,PadraoSistema)
                        VALUES(
                            ${g},
                            N'${esc(n)}',
                            1
                        );`
                )
                .join('')
        );
    }

    console.log('ATLAS: banco inicializado.');
}

/* =========================================================
   API
   ========================================================= */

async function api(req, res, u) {

    const url = new URL(
        req.url,
        'http://atlas'
    );

    /* SETUP */

    if (
        url.pathname === '/api/setup/status'
    ) {

        const r = await sql(`
            SELECT COUNT(*) N
            FROM dbo.Usuarios
        `);

        return send(res, 200, {
            required: +r[0].N === 0
        });
    }

    if (
        url.pathname === '/api/setup' &&
        req.method === 'POST'
    ) {

        const existing = await sql(`
            SELECT COUNT(*) N
            FROM dbo.Usuarios
        `);

        if (+existing[0].N) {

            return send(res, 409, {
                error:
                    'Configuração inicial já concluída.'
            });
        }

        const b = await body(req);

        if (
            !b.nome ||
            !/^\S+@\S+\.\S+$/.test(
                b.email || ''
            ) ||
            (b.senha || '').length < 10
        ) {

            return send(res, 400, {
                error:
                    'Informe nome, e-mail válido e senha com pelo menos 10 caracteres.'
            });
        }

        await exec(`
INSERT dbo.Usuarios(
    Nome,
    Email,
    PasswordHash,
    Role
)
VALUES(
    N'${esc(b.nome)}',
    N'${esc(
        b.email.toLowerCase()
    )}',
    N'${esc(hash(b.senha))}',
    'ADMIN'
)
`);

        return send(res, 201, {
            ok: true
        });
    }

    /* LOGIN */

    if (
        url.pathname === '/api/login' &&
        req.method === 'POST'
    ) {

        const b = await body(req);

        const a = await sql(`
SELECT TOP 1
    Id,
    Nome,
    Email,
    PasswordHash,
    Role
FROM dbo.Usuarios
WHERE
    Email=N'${esc(
        (b.email || '').toLowerCase()
    )}'
    AND Ativo=1
`);

        if (
            !a[0] ||
            !verify(
                b.senha || '',
                a[0].PasswordHash
            )
        ) {

            return send(res, 401, {
                error:
                    'E-mail ou senha inválidos.'
            });
        }

        res.setHeader(
            'Set-Cookie',
            `AtlasAuth=${token(
                a[0]
            )}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`
        );

        return send(res, 200, {
            ok: true
        });
    }

    /* LOGOUT */

    if (
        url.pathname === '/api/logout' &&
        req.method === 'POST'
    ) {

        res.setHeader(
            'Set-Cookie',
            'AtlasAuth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
        );

        return send(res, 200, {
            ok: true
        });
    }

    /* ROTAS PROTEGIDAS */

    if (!u) {

        return send(res, 401, {
            error: 'Não autenticado.'
        });
    }

    if (
        url.pathname === '/api/me'
    ) {

        return send(res, 200, u);
    }

    /* CADASTROS */

    if (
        url.pathname === '/api/cadastros' &&
        req.method === 'GET'
    ) {

        return send(
            res,
            200,
            await sql(`
SELECT
    Id,
    Grupo,
    Nome
FROM dbo.CadastrosFinanceiros
WHERE
    Ativo=1
    AND (
        PadraoSistema=1
        OR UsuarioId=${u.id}
    )
ORDER BY
    Grupo,
    Nome
`)
        );
    }

    if (
        url.pathname === '/api/cadastros' &&
        req.method === 'POST'
    ) {

        const b = await body(req);

        const g = +b.grupo;
        const n = String(
            b.nome || ''
        ).trim();

        if (
            ![1, 2, 3, 4].includes(g) ||
            !n
        ) {

            return send(res, 400, {
                error:
                    'Cadastro inválido.'
            });
        }

        let a = await sql(`
SELECT TOP 1
    Id,
    Nome
FROM dbo.CadastrosFinanceiros
WHERE
    Grupo=${g}
    AND Ativo=1
    AND (
        PadraoSistema=1
        OR UsuarioId=${u.id}
    )
    AND Nome=N'${esc(n)}'
`);

        if (!a[0]) {

            await exec(`
INSERT dbo.CadastrosFinanceiros(
    UsuarioId,
    Grupo,
    Nome
)
VALUES(
    ${u.id},
    ${g},
    N'${esc(n)}'
)
`);

            a = await sql(`
SELECT TOP 1
    Id,
    Nome
FROM dbo.CadastrosFinanceiros
WHERE UsuarioId=${u.id}
ORDER BY Id DESC
`);
        }

        return send(
            res,
            201,
            a[0]
        );
    }

    /* CONSULTAR LANÇAMENTOS */

    if (
        url.pathname === '/api/lancamentos' &&
        req.method === 'GET'
    ) {

        const v = month(
            url.searchParams.get(
                'vigencia'
            ) || ''
        );

        if (!v) {

            return send(res, 400, {
                error:
                    'Vigência inválida.'
            });
        }

        return send(
            res,
            200,
            await sql(`
SELECT
    l.*,
    t.Nome Tipo,
    c.Nome Categoria,
    f.Nome FormaPagamento,
    p.Nome ComoSeraPago
FROM dbo.Lancamentos l

JOIN dbo.CadastrosFinanceiros t
    ON t.Id=l.TipoId

JOIN dbo.CadastrosFinanceiros c
    ON c.Id=l.CategoriaId

JOIN dbo.CadastrosFinanceiros f
    ON f.Id=l.FormaPagamentoId

JOIN dbo.CadastrosFinanceiros p
    ON p.Id=l.ComoSeraPagoId

WHERE
    l.UsuarioId=${u.id}
    AND l.Vigencia='${v}'

ORDER BY
    l.Id DESC
`)
        );
    }

    /* CRIAR LANÇAMENTO */

    if (
        url.pathname === '/api/lancamentos' &&
        req.method === 'POST'
    ) {

        const b = await body(req);

        const v = month(
            b.vigencia
        );

        const valor = Number(
            b.valor
        );

        if (
            !v ||
            !valor ||
            valor <= 0 ||
            !b.descricao
        ) {

            return send(res, 400, {
                error:
                    'Preencha os dados obrigatórios.'
            });
        }

        const ids = [
            'tipoId',
            'categoriaId',
            'formaPagamentoId',
            'comoSeraPagoId'
        ];

        if (
            ids.some(
                k =>
                    !Number.isInteger(
                        +b[k]
                    )
            )
        ) {

            return send(res, 400, {
                error:
                    'Seleções inválidas.'
            });
        }

        const modo = (
            await sql(`
SELECT TOP 1 Nome
FROM dbo.CadastrosFinanceiros
WHERE
    Id=${+b.comoSeraPagoId}
    AND (
        PadraoSistema=1
        OR UsuarioId=${u.id}
    )
`)
        )[0];

        if (!modo) {

            return send(res, 400, {
                error:
                    'Forma de pagamento inválida.'
            });
        }

        const base =
            `${u.id},` +
            `${+b.tipoId},` +
            `${+b.categoriaId},` +
            `${+b.formaPagamentoId},` +
            `${+b.comoSeraPagoId},` +
            `N'${esc(
                b.descricao
            )}',` +
            `${valor.toFixed(2)}`;

        /* PARCELADO */

        if (
            modo.Nome.toLowerCase() ===
            'parcelado'
        ) {

            const q =
                +b.quantidadeParcelas;

            if (
                !Number.isInteger(q) ||
                q < 2
            ) {

                return send(
                    res,
                    400,
                    {
                        error:
                            'Informe a quantidade de parcelas.'
                    }
                );
            }

            const sid =
                crypto.randomUUID();

            let ql = `
INSERT dbo.SeriesFinanceiras(
    Id,
    UsuarioId,
    Regra,
    Quantidade,
    VigenciaInicial
)
VALUES(
    '${sid}',
    ${u.id},
    'PARCELADO',
    ${q},
    '${v}'
);
`;

            for (
                let p = 1;
                p <= q;
                p++
            ) {

                ql += `
INSERT dbo.Lancamentos(
    UsuarioId,
    TipoId,
    CategoriaId,
    FormaPagamentoId,
    ComoSeraPagoId,
    Descricao,
    Valor,
    Vigencia,
    SerieId,
    ParcelaAtual,
    TotalParcelas
)
VALUES(
    ${base},
    DATEADD(
        month,
        ${p - 1},
        '${v}'
    ),
    '${sid}',
    ${p},
    ${q}
);
`;
            }

            await exec(ql);

        /* RECORRENTE */

        } else if (
            modo.Nome.toLowerCase() ===
            'recorrente'
        ) {

            const sid =
                crypto.randomUUID();

            await exec(`
INSERT dbo.SeriesFinanceiras(
    Id,
    UsuarioId,
    Regra,
    VigenciaInicial
)
VALUES(
    '${sid}',
    ${u.id},
    'RECORRENTE',
    '${v}'
);

INSERT dbo.Lancamentos(
    UsuarioId,
    TipoId,
    CategoriaId,
    FormaPagamentoId,
    ComoSeraPagoId,
    Descricao,
    Valor,
    Vigencia,
    SerieId
)
VALUES(
    ${base},
    '${v}',
    '${sid}'
);
`);

        /* À VISTA / OUTROS */

        } else {

            await exec(`
INSERT dbo.Lancamentos(
    UsuarioId,
    TipoId,
    CategoriaId,
    FormaPagamentoId,
    ComoSeraPagoId,
    Descricao,
    Valor,
    Vigencia
)
VALUES(
    ${base},
    '${v}'
);
`);
        }

        await exec(`
INSERT dbo.AuditLog(
    UsuarioId,
    Acao,
    Dados
)
VALUES(
    ${u.id},
    N'CRIAR_LANCAMENTO',
    N'${esc(
        b.descricao
    )}'
)
`);

        return send(res, 201, {
            ok: true
        });
    }

    /* DASHBOARD */

    if (
        url.pathname ===
        '/api/dashboard'
    ) {

        const v = month(
            url.searchParams.get(
                'vigencia'
            ) || ''
        );

        if (!v) {

            return send(res, 400, {
                error:
                    'Vigência inválida.'
            });
        }

        const result =
            await sql(`
SELECT
    COUNT(*) Quantidade,
    COALESCE(
        SUM(Valor),
        0
    ) Movimentacao
FROM dbo.Lancamentos
WHERE
    UsuarioId=${u.id}
    AND Vigencia='${v}'
`);

        return send(
            res,
            200,
            result[0]
        );
    }

    return send(res, 404, {
        error:
            'Não encontrado.'
    });
}

/* =========================================================
   ARQUIVOS ESTÁTICOS
   ========================================================= */

function staticFile(req, res) {

    let p = new URL(
        req.url,
        'http://atlas'
    ).pathname;

    if (p === '/') {
        p = '/index.html';
    }

    const f = path.join(
        PUB,
        path
            .normalize(p)
            .replace(
                /^(\.\.[/\\])+/,
                ''
            )
    );

    if (
        !f.startsWith(PUB) ||
        !fs.existsSync(f) ||
        fs.statSync(f).isDirectory()
    ) {

        return send(
            res,
            404,
            'Não encontrado.',
            'text/plain; charset=utf-8'
        );
    }

    const ext =
        path.extname(f);

    const types = {
        '.html':
            'text/html; charset=utf-8',
        '.css':
            'text/css; charset=utf-8',
        '.js':
            'application/javascript; charset=utf-8'
    };

    res.writeHead(200, {
        'Content-Type':
            types[ext] ||
            'application/octet-stream'
    });

    fs.createReadStream(f).pipe(res);
}

/* =========================================================
   START ATLAS
   ========================================================= */

let ready = false;
let bootError = null;

init()
    .then(() => {

        ready = true;

        console.log(
            'ATLAS inicializado com sucesso.'
        );

    })
    .catch(e => {

        bootError = e;

        console.error(
            'ERRO NA INICIALIZAÇÃO DO ATLAS:'
        );

        console.error(e);
    });

http
    .createServer(
        async (req, res) => {

            try {

                if (!ready) {

                    if (bootError) {

                        return send(
                            res,
                            500,
                            {
                                error:
                                    bootError.message
                            }
                        );
                    }

                    return send(
                        res,
                        503,
                        {
                            error:
                                'ATLAS iniciando.'
                        }
                    );
                }

                const u =
                    user(req);

                if (
                    req.url.startsWith(
                        '/api/'
                    )
                ) {

                    return await api(
                        req,
                        res,
                        u
                    );
                }

                return staticFile(
                    req,
                    res
                );

            } catch (e) {

                console.error(e);

                return send(
                    res,
                    500,
                    {
                        error:
                            'Erro interno do ATLAS.',
                        detail:
                            e.message
                    }
                );
            }
        }
    )
    .listen(
        PORT,
        () => {

            console.log(
                'ATLAS online na porta ' +
                PORT
            );
        }
    );
