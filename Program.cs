using Atlas.Data;
using Atlas.Services;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
var connection = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? builder.Configuration["ConnectionStrings__DefaultConnection"]
    ?? builder.Configuration["DB_CONNECTION_STRING"];
if (string.IsNullOrWhiteSpace(connection))
    throw new InvalidOperationException("Configure ConnectionStrings__DefaultConnection no MonsterASP.");

// Explicit SQL transactions are used by financial operations and recurring series.
// EF Core's automatic retrying execution strategy is incompatible with manually
// initiated transactions unless the complete transaction uses ExecuteAsync.
// Keep transactions atomic and disable implicit retries until per-operation
// idempotent retry units are implemented.
builder.Services.AddDbContext<FinanceDbContext>(options => options.UseSqlServer(connection));
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<CurrentUser>();
builder.Services.AddScoped<PasswordService>();
builder.Services.AddScoped<AuditService>();
builder.Services.AddScoped<RecurringService>();
builder.Services.AddScoped<FinancialService>();
builder.Services.AddControllersWithViews(options => options.Filters.Add(new Microsoft.AspNetCore.Mvc.AutoValidateAntiforgeryTokenAttribute()));
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(o => {
        o.Cookie.Name = "AtlasFinanceSession";
        o.Cookie.HttpOnly = true;
        o.Cookie.SameSite = SameSiteMode.Lax;
        // Em sites com TLS terminado no proxy ou ainda acessados por HTTP,
        // Always faz o navegador descartar a sessao em HTTP apos o login.
        // SameAsRequest protege o cookie em requisicoes HTTPS e o torna
        // utilizavel no esquema que realmente recebeu a requisicao.
        // HTTPS e obrigatorio para trafego financeiro em producao.
        o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        o.SlidingExpiration = true;
        o.ExpireTimeSpan = TimeSpan.FromDays(7);
        o.LoginPath = "/Auth/Login";
        o.AccessDeniedPath = "/Auth/Login";
    });
builder.Services.AddAuthorization();
builder.Services.Configure<ForwardedHeadersOptions>(o => {
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
});

var app = builder.Build();
app.UseForwardedHeaders();
if (!app.Environment.IsDevelopment()) app.UseExceptionHandler("/Home/Error");
app.UseStaticFiles();
app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();
app.MapGet("/health", () => Results.Ok(new { status = "ok", application = "ATLAS", version = "3.0" }));
// Non-mutating POST probe: checks the IIS / ASP.NET Core HTTP verb pipeline without login or data.
app.MapPost("/health/http-post", () => Results.Ok(new { status = "ok", method = "POST" }));
app.MapGet("/health/db", async (FinanceDbContext db, CancellationToken ct) =>
    await db.Database.CanConnectAsync(ct) ? Results.Ok(new { status = "ok" }) : Results.StatusCode(503))
    .RequireAuthorization();
app.MapControllerRoute(name: "default", pattern: "{controller=Home}/{action=Index}/{id?}");

// O schema financeiro novo não altera as tabelas financeiras da aplicação anterior.
// Em falha de conexão/migração, mantemos o processo iniciado para diagnóstico em /health.
try {
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<FinanceDbContext>();
    await AtlasSchema.EnsureAsync(db);
} catch (Exception e) {
    app.Logger.LogCritical(e, "Falha ao preparar o banco financeiro. Verifique a conexão SQL Server e permissões DDL.");
}
await app.RunAsync();