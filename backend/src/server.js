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

IF OBJECT_ID('dbo.ExcecoesRecorrencia') IS NULL
CREATE TABLE dbo.ExcecoesRecorrencia(
    Id BIGINT IDENTITY PRIMARY KEY,
    UsuarioId INT NOT NULL,
    SerieId UNIQUEIDENTIFIER NOT NULL,
    Vigencia DATE NOT NULL,
    Acao VARCHAR(20) NOT NULL,
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
            )}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`
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

        const lancamentos = await sql(`
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

    AND NOT EXISTS(
        SELECT 1
        FROM dbo.ExcecoesRecorrencia e
        WHERE
            e.UsuarioId=${u.id}
            AND e.SerieId=l.SerieId
            AND e.Vigencia=l.Vigencia
            AND e.Acao='EXCLUIR'
    )

ORDER BY
    l.Id DESC
`);

        const recorrentes = await sql(`
SELECT
    l.Id,
    l.UsuarioId,
    l.TipoId,
    l.CategoriaId,
    l.FormaPagamentoId,
    l.ComoSeraPagoId,
    l.Descricao,
    l.Valor,
    CAST('${v}' AS DATE) Vigencia,
    l.SerieId,
    NULL ParcelaAtual,
    NULL TotalParcelas,
    l.Origem,
    l.CriadoEm,
    t.Nome Tipo,
    c.Nome Categoria,
    f.Nome FormaPagamento,
    p.Nome ComoSeraPago
FROM dbo.SeriesFinanceiras s

JOIN dbo.Lancamentos l
    ON l.SerieId=s.Id
    AND l.Vigencia=s.VigenciaInicial

JOIN dbo.CadastrosFinanceiros t
    ON t.Id=l.TipoId

JOIN dbo.CadastrosFinanceiros c
    ON c.Id=l.CategoriaId

JOIN dbo.CadastrosFinanceiros f
    ON f.Id=l.FormaPagamentoId

JOIN dbo.CadastrosFinanceiros p
    ON p.Id=l.ComoSeraPagoId

WHERE
    s.UsuarioId=${u.id}
    AND s.Regra='RECORRENTE'
    AND s.VigenciaInicial<='${v}'
    AND (
        s.CanceladaAPartirDe IS NULL
        OR s.CanceladaAPartirDe>'${v}'
    )
    AND '${v}'<>s.VigenciaInicial

    AND NOT EXISTS(
        SELECT 1
        FROM dbo.ExcecoesRecorrencia e
        WHERE
            e.UsuarioId=${u.id}
            AND e.SerieId=s.Id
            AND e.Vigencia='${v}'
            AND e.Acao='EXCLUIR'
    )

    AND NOT EXISTS(
        SELECT 1
        FROM dbo.Lancamentos ex
        WHERE
            ex.UsuarioId=${u.id}
            AND ex.SerieId=s.Id
            AND ex.Vigencia='${v}'
    )
`);


        return send(
            res,
            200,
            [
                ...lancamentos,
                ...recorrentes
            ]
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
    ${u.id},
    ${+b.tipoId},
    ${+b.categoriaId},
    ${+b.formaPagamentoId},
    ${+b.comoSeraPagoId},
    N'${descricao}',
    ${valor.toFixed(2)},
    '${v}',
    '${sid}'
);
`);

            } else {

                /*
                    Se a ocorrência recorrente ainda é
                    virtual, cria uma exceção física
                    somente para aquele mês.
                */

                const vigenciaInicial = atual.VigenciaInicial
                    ? new Date(atual.VigenciaInicial)
                        .toISOString()
                        .slice(0, 10)
                    : null;

                /*
                    Se estamos editando justamente o PRIMEIRO mês
                    da recorrência, não podemos alterar simplesmente
                    o registro-base, porque ele gera os meses futuros.
                */
                if (vigenciaInicial === v) {

                    /*
                        Guarda os dados originais antes de alterar
                        somente este mês.
                    */
                    const original = {
                        TipoId: atual.TipoId,
                        CategoriaId: atual.CategoriaId,
                        FormaPagamentoId: atual.FormaPagamentoId,
                        ComoSeraPagoId: atual.ComoSeraPagoId,
                        Descricao: atual.Descricao,
                        Valor: Number(atual.Valor)
                    };

                    const proxima = (
                        await sql(`
SELECT CONVERT(
    VARCHAR(10),
    DATEADD(month, 1, '${v}'),
    23
) Vigencia
`)
                    )[0].Vigencia;

                    const cancelamentoOriginal =
                        atual.CanceladaAPartirDe
                            ? new Date(atual.CanceladaAPartirDe)
                                .toISOString()
                                .slice(0, 10)
                            : null;

                    /*
                        A série original termina depois deste mês.
                    */
                    await exec(`
UPDATE dbo.SeriesFinanceiras
SET
    CanceladaAPartirDe='${proxima}'
WHERE
    Id='${atual.SerieId}'
    AND UsuarioId=${u.id}
`);

                    /*
                        Agora o registro inicial pode receber
                        a alteração exclusiva deste mês.
                    */
                    await exec(`
UPDATE dbo.Lancamentos
SET
    ${setDados}
WHERE
    Id=${id}
    AND UsuarioId=${u.id}
`);

                    /*
                        Recria a continuidade da recorrência
                        a partir do próximo mês usando os
                        dados ORIGINAIS.
                    */
                    if (
                        !cancelamentoOriginal ||
                        cancelamentoOriginal > proxima
                    ) {

                        const novaSerie = crypto.randomUUID();

                        await exec(`
INSERT dbo.SeriesFinanceiras(
    Id,
    UsuarioId,
    Regra,
    VigenciaInicial,
    CanceladaAPartirDe
)
VALUES(
    '${novaSerie}',
    ${u.id},
    'RECORRENTE',
    '${proxima}',
    ${
        cancelamentoOriginal
            ? `'${cancelamentoOriginal}'`
            : 'NULL'
    }
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
    SerieId,
    Origem
)
VALUES(
    ${u.id},
    ${original.TipoId},
    ${original.CategoriaId},
    ${original.FormaPagamentoId},
    ${original.ComoSeraPagoId},
    N'${esc(original.Descricao)}',
    ${original.Valor.toFixed(2)},
    '${proxima}',
    '${novaSerie}',
    '${esc(atual.Origem || 'PORTAL')}'
);
`);
                    }

                } else {

                    /*
                        Para qualquer mês posterior ao primeiro,
                        cria ou altera somente a ocorrência
                        específica daquele mês.
                    */
                    const fisico = (
                        await sql(`
SELECT TOP 1 Id
FROM dbo.Lancamentos
WHERE
    UsuarioId=${u.id}
    AND SerieId='${atual.SerieId}'
    AND Vigencia='${v}'
`)
                    )[0];

                    if (fisico) {

                        await exec(`
UPDATE dbo.Lancamentos
SET
    ${setDados}
WHERE
    Id=${fisico.Id}
    AND UsuarioId=${u.id}
`);

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
    Vigencia,
    SerieId
)
VALUES(
    ${u.id},
    ${+b.tipoId},
    ${+b.categoriaId},
    ${+b.formaPagamentoId},
    ${+b.comoSeraPagoId},
    N'${descricao}',
    ${valor.toFixed(2)},
    '${v}',
    '${atual.SerieId}'
);
`);
                    }
                }

            }
        }

        await exec(`
INSERT dbo.AuditLog(
    UsuarioId,
    Acao,
    Dados
)
VALUES(
    ${u.id},
    N'EDITAR_LANCAMENTO',
    N'ID ${id} | ${escopo} | ${descricao}'
)
`);

        return send(res, 200, {
            ok: true
        });
    }

    /* =========================================================
       EXCLUIR / CANCELAR LANÇAMENTO
       ========================================================= */

    if (
        url.pathname === '/api/lancamentos/excluir' &&
        req.method === 'POST'
    ) {

        const b = await body(req);

        const id = Number(b.id);
        const v = month(b.vigencia);
        const escopo =
            String(
                b.escopo || 'UNICO'
            ).toUpperCase();

        if (
            !Number.isInteger(id) ||
            id <= 0 ||
            !v
        ) {
            return send(res, 400, {
                error: 'Dados inválidos.'
            });
        }

        const atual = (
            await sql(`
SELECT TOP 1
    l.*,
    s.Regra,
    s.VigenciaInicial,
    s.CanceladaAPartirDe
FROM dbo.Lancamentos l
LEFT JOIN dbo.SeriesFinanceiras s
    ON s.Id=l.SerieId
WHERE
    l.Id=${id}
    AND l.UsuarioId=${u.id}
`)
        )[0];

        if (!atual) {
            return send(res, 404, {
                error: 'Lançamento não encontrado.'
            });
        }

        /* LANÇAMENTO ÚNICO */

        if (!atual.SerieId) {

            await exec(`
DELETE FROM dbo.Lancamentos
WHERE
    Id=${id}
    AND UsuarioId=${u.id}
`);

        /* PARCELADO */

        } else if (
            String(atual.Regra).toUpperCase() ===
            'PARCELADO'
        ) {

            if (
                escopo === 'PROXIMOS'
            ) {

                await exec(`
DELETE FROM dbo.Lancamentos
WHERE
    UsuarioId=${u.id}
    AND SerieId='${atual.SerieId}'
    AND Vigencia>='${v}'
`);

            } else {

                await exec(`
DELETE FROM dbo.Lancamentos
WHERE
    Id=${id}
    AND UsuarioId=${u.id}
`);
            }

        /* RECORRENTE */

        } else if (
            String(atual.Regra).toUpperCase() ===
            'RECORRENTE'
        ) {

            if (
                escopo === 'PROXIMOS'
            ) {

                await exec(`
UPDATE dbo.SeriesFinanceiras
SET
    CanceladaAPartirDe='${v}'
WHERE
    Id='${atual.SerieId}'
    AND UsuarioId=${u.id};

DELETE FROM dbo.Lancamentos
WHERE
    UsuarioId=${u.id}
    AND SerieId='${atual.SerieId}'
    AND Vigencia>='${v}'
    AND Vigencia<>(
        SELECT VigenciaInicial
        FROM dbo.SeriesFinanceiras
        WHERE Id='${atual.SerieId}'
    );
`);

            } else {

                /*
                    Excluir apenas uma ocorrência recorrente
                    precisa registrar uma exceção para que
                    ela não seja recriada pela projeção.
                */

                await exec(`
IF OBJECT_ID('dbo.ExcecoesRecorrencia') IS NULL
CREATE TABLE dbo.ExcecoesRecorrencia(
    Id BIGINT IDENTITY PRIMARY KEY,
    UsuarioId INT NOT NULL,
    SerieId UNIQUEIDENTIFIER NOT NULL,
    Vigencia DATE NOT NULL,
    Acao VARCHAR(20) NOT NULL,
    CriadoEm DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

IF NOT EXISTS(
    SELECT 1
    FROM dbo.ExcecoesRecorrencia
    WHERE
        UsuarioId=${u.id}
        AND SerieId='${atual.SerieId}'
        AND Vigencia='${v}'
        AND Acao='EXCLUIR'
)
INSERT dbo.ExcecoesRecorrencia(
    UsuarioId,
    SerieId,
    Vigencia,
    Acao
)
VALUES(
    ${u.id},
    '${atual.SerieId}',
    '${v}',
    'EXCLUIR'
);

DELETE FROM dbo.Lancamentos
WHERE
    UsuarioId=${u.id}
    AND SerieId='${atual.SerieId}'
    AND Vigencia='${v}'
    AND Vigencia<>(
        SELECT VigenciaInicial
        FROM dbo.SeriesFinanceiras
        WHERE Id='${atual.SerieId}'
    );
`);
            }
        }

        await exec(`
INSERT dbo.AuditLog(
    UsuarioId,
    Acao,
    Dados
)
VALUES(
    ${u.id},
    N'EXCLUIR_LANCAMENTO',
    N'ID ${id} | ${escopo} | ${esc(
        atual.Descricao
    )}'
)
`);

        return send(res, 200, {
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

        const result = await sql(`
SELECT
    COUNT(*) Quantidade,

    COALESCE(
        SUM(
            CASE
                WHEN LOWER(Tipo) = N'receita' THEN Valor
                WHEN LOWER(Tipo) = N'despesa' THEN -Valor
                ELSE 0
            END
        ),
        0
    ) Saldo,

    COALESCE(
        SUM(
            CASE
                WHEN LOWER(Tipo) = N'receita' THEN Valor
                ELSE 0
            END
        ),
        0
    ) Receitas,

    COALESCE(
        SUM(
            CASE
                WHEN LOWER(Tipo) = N'despesa' THEN -Valor
                ELSE 0
            END
        ),
        0
    ) Despesas,

    COALESCE(
        SUM(
            CASE
                WHEN LOWER(Tipo) = N'economia' THEN Valor
                ELSE 0
            END
        ),
        0
    ) Economia,

    COALESCE(
        SUM(
            CASE
                WHEN LOWER(Tipo) = N'receita' THEN Valor
                WHEN LOWER(Tipo) = N'despesa' THEN -Valor
                WHEN LOWER(Tipo) = N'economia' THEN Valor
                ELSE 0
            END
        ),
        0
    ) Movimentacao

FROM (
SELECT
    l.Id,
    l.Valor,
    t.Nome Tipo
FROM dbo.Lancamentos l

JOIN dbo.CadastrosFinanceiros t
    ON t.Id=l.TipoId
    WHERE
        l.UsuarioId=${u.id}
        AND l.Vigencia='${v}'

        AND NOT EXISTS(
            SELECT 1
            FROM dbo.ExcecoesRecorrencia e
            WHERE
                e.UsuarioId=${u.id}
                AND e.SerieId=l.SerieId
                AND e.Vigencia=l.Vigencia
                AND e.Acao='EXCLUIR'
        )


    UNION ALL

SELECT
    l.Id,
    l.Valor,
    t.Nome Tipo
FROM dbo.SeriesFinanceiras s

JOIN dbo.Lancamentos l
    ON l.SerieId=s.Id
    AND l.Vigencia=s.VigenciaInicial

JOIN dbo.CadastrosFinanceiros t
    ON t.Id=l.TipoId

    WHERE
        s.UsuarioId=${u.id}
        AND s.Regra='RECORRENTE'
        AND s.VigenciaInicial<'${v}'
        AND (
            s.CanceladaAPartirDe IS NULL
            OR s.CanceladaAPartirDe>'${v}'
        )

        AND NOT EXISTS(
            SELECT 1
            FROM dbo.ExcecoesRecorrencia e
            WHERE
                e.UsuarioId=${u.id}
                AND e.SerieId=s.Id
                AND e.Vigencia='${v}'
                AND e.Acao='EXCLUIR'
        )

        AND NOT EXISTS(
            SELECT 1
            FROM dbo.Lancamentos ex
            WHERE
                ex.UsuarioId=${u.id}
                AND ex.SerieId=s.Id
                AND ex.Vigencia='${v}'
        )
) x
`);


const anterior = await sql(`
SELECT
    COALESCE(
        SUM(
            CASE
                WHEN LOWER(Tipo)=N'receita' THEN Valor
                ELSE 0
            END
        ),
        0
    ) Receitas,

    COALESCE(
        SUM(
            CASE
                WHEN LOWER(Tipo)=N'despesa' THEN -Valor
                ELSE 0
            END
        ),
        0
    ) Despesas,

    COALESCE(
        SUM(
            CASE
                WHEN LOWER(Tipo)=N'receita' THEN Valor
                WHEN LOWER(Tipo)=N'despesa' THEN -Valor
                ELSE 0
            END
        ),
        0
    ) Saldo

FROM (

    SELECT
        l.Valor,
        t.Nome Tipo

    FROM dbo.Lancamentos l

    JOIN dbo.CadastrosFinanceiros t
        ON t.Id=l.TipoId

    WHERE
        l.UsuarioId=${u.id}
        AND l.Vigencia=DATEADD(month,-1,'${v}')

        AND NOT EXISTS(
            SELECT 1
            FROM dbo.ExcecoesRecorrencia e
            WHERE
                e.UsuarioId=${u.id}
                AND e.SerieId=l.SerieId
                AND e.Vigencia=l.Vigencia
                AND e.Acao='EXCLUIR'
        )

    UNION ALL

    SELECT
        l.Valor,
        t.Nome Tipo

    FROM dbo.SeriesFinanceiras s

    JOIN dbo.Lancamentos l
        ON l.SerieId=s.Id
        AND l.Vigencia=s.VigenciaInicial

    JOIN dbo.CadastrosFinanceiros t
        ON t.Id=l.TipoId

    WHERE
        s.UsuarioId=${u.id}
        AND s.Regra='RECORRENTE'

        AND s.VigenciaInicial<
            DATEADD(month,-1,'${v}')

        AND (
            s.CanceladaAPartirDe IS NULL
            OR s.CanceladaAPartirDe>
                DATEADD(month,-1,'${v}')
        )

        AND NOT EXISTS(
            SELECT 1
            FROM dbo.ExcecoesRecorrencia e
            WHERE
                e.UsuarioId=${u.id}
                AND e.SerieId=s.Id
                AND e.Vigencia=
                    DATEADD(month,-1,'${v}')
                AND e.Acao='EXCLUIR'
        )

        AND NOT EXISTS(
            SELECT 1
            FROM dbo.Lancamentos ex
            WHERE
                ex.UsuarioId=${u.id}
                AND ex.SerieId=s.Id
                AND ex.Vigencia=
                    DATEADD(month,-1,'${v}')
        )

) x
`);



const categoriasDespesas = await sql(`
SELECT
    Categoria,
    SUM(Valor) Valor
FROM (

    SELECT
        c.Nome Categoria,
        l.Valor

    FROM dbo.Lancamentos l

    JOIN dbo.CadastrosFinanceiros t
        ON t.Id=l.TipoId

    JOIN dbo.CadastrosFinanceiros c
        ON c.Id=l.CategoriaId

    WHERE
        l.UsuarioId=${u.id}
        AND l.Vigencia='${v}'
        AND LOWER(t.Nome)=N'despesa'

        AND NOT EXISTS(
            SELECT 1
            FROM dbo.ExcecoesRecorrencia e
            WHERE
                e.UsuarioId=${u.id}
                AND e.SerieId=l.SerieId
                AND e.Vigencia=l.Vigencia
                AND e.Acao='EXCLUIR'
        )

    UNION ALL

    SELECT
        c.Nome Categoria,
        l.Valor

    FROM dbo.SeriesFinanceiras s

    JOIN dbo.Lancamentos l
        ON l.SerieId=s.Id
        AND l.Vigencia=s.VigenciaInicial

    JOIN dbo.CadastrosFinanceiros t
        ON t.Id=l.TipoId

    JOIN dbo.CadastrosFinanceiros c
        ON c.Id=l.CategoriaId

    WHERE
        s.UsuarioId=${u.id}
        AND s.Regra='RECORRENTE'
        AND LOWER(t.Nome)=N'despesa'
        AND s.VigenciaInicial<'${v}'

        AND (
            s.CanceladaAPartirDe IS NULL
            OR s.CanceladaAPartirDe>'${v}'
        )

        AND NOT EXISTS(
            SELECT 1
            FROM dbo.ExcecoesRecorrencia e
            WHERE
                e.UsuarioId=${u.id}
                AND e.SerieId=s.Id
                AND e.Vigencia='${v}'
                AND e.Acao='EXCLUIR'
        )

        AND NOT EXISTS(
            SELECT 1
            FROM dbo.Lancamentos ex
            WHERE
                ex.UsuarioId=${u.id}
                AND ex.SerieId=s.Id
                AND ex.Vigencia='${v}'
        )

) x

GROUP BY Categoria
ORDER BY Valor DESC
`);

const maioresDespesas = await sql(`
SELECT TOP 5 Descricao, Categoria, Valor
FROM (
    SELECT l.Descricao, c.Nome Categoria, l.Valor
    FROM dbo.Lancamentos l
    JOIN dbo.CadastrosFinanceiros t ON t.Id=l.TipoId
    JOIN dbo.CadastrosFinanceiros c ON c.Id=l.CategoriaId
    WHERE l.UsuarioId=${u.id}
      AND l.Vigencia='${v}'
      AND LOWER(t.Nome)=N'despesa'
      AND NOT EXISTS(
        SELECT 1 FROM dbo.ExcecoesRecorrencia e
        WHERE e.UsuarioId=${u.id}
          AND e.SerieId=l.SerieId
          AND e.Vigencia=l.Vigencia
          AND e.Acao='EXCLUIR'
      )
    UNION ALL
    SELECT l.Descricao, c.Nome Categoria, l.Valor
    FROM dbo.SeriesFinanceiras s
    JOIN dbo.Lancamentos l ON l.SerieId=s.Id AND l.Vigencia=s.VigenciaInicial
    JOIN dbo.CadastrosFinanceiros t ON t.Id=l.TipoId
    JOIN dbo.CadastrosFinanceiros c ON c.Id=l.CategoriaId
    WHERE s.UsuarioId=${u.id}
      AND s.Regra='RECORRENTE'
      AND LOWER(t.Nome)=N'despesa'
      AND s.VigenciaInicial<'${v}'
      AND (s.CanceladaAPartirDe IS NULL OR s.CanceladaAPartirDe>'${v}')
      AND NOT EXISTS(
        SELECT 1 FROM dbo.ExcecoesRecorrencia e
        WHERE e.UsuarioId=${u.id}
          AND e.SerieId=s.Id
          AND e.Vigencia='${v}'
          AND e.Acao='EXCLUIR'
      )
      AND NOT EXISTS(
        SELECT 1 FROM dbo.Lancamentos ex
        WHERE ex.UsuarioId=${u.id}
          AND ex.SerieId=s.Id
          AND ex.Vigencia='${v}'
      )
) x
ORDER BY Valor DESC
`);

return send(res,200,{
    ...result[0],
    Anterior:{
        Receitas:Number(anterior[0]?.Receitas||0),
        Despesas:Number(anterior[0]?.Despesas||0),
        Saldo:Number(anterior[0]?.Saldo||0)
    },
    CategoriasDespesas:categoriasDespesas.map(x=>({
        Categoria:x.Categoria,
        Valor:Number(x.Valor||0)
    })),
    MaioresDespesas:maioresDespesas.map(x=>({
        Descricao:x.Descricao,
        Categoria:x.Categoria,
        Valor:Number(x.Valor||0)
    }))
});

    }

    return send(res,404,{error:'Não encontrado.'});
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