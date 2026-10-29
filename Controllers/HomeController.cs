using Atlas.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Atlas.Controllers;

[Authorize]
public class HomeController(FinancialService finance, CurrentUser user, ILogger<HomeController> logger) : Controller {
    [HttpGet]
    public async Task<IActionResult> Index(int? year,int? month){
        var y=year??DateTime.Today.Year;var m=month??DateTime.Today.Month;
        if(y is < 2000 or > 2100 || m is < 1 or > 12)return BadRequest("Competência inválida.");
        return View(await finance.DashboardAsync(user.Id,y,m));
    }

    // The exception handler re-executes the original HTTP method. Restricting
    // this endpoint to GET converted every failed financial POST into HTTP 405.
    [AllowAnonymous]
    public IActionResult Error(){
        Response.StatusCode=StatusCodes.Status500InternalServerError;
        var feature=HttpContext.Features.Get<IExceptionHandlerPathFeature>();
        var trace=HttpContext.TraceIdentifier;
        ViewData["DiagnosticCode"]=trace;
        ViewData["DiagnosticCategory"]="Falha interna ao processar a operação.";
        if(feature?.Error is { } error){
            logger.LogError(error,"ATLAS request failed. TraceId={TraceId} Method={Method} OriginalPath={Path}",
                trace,Request.Method,feature.Path);
            SqlException? sql=error as SqlException;
            if(sql is null && error is DbUpdateException update)sql=update.InnerException as SqlException;
            sql??=error.InnerException as SqlException;
            if(sql is not null){
                ViewData["DiagnosticCategory"]=sql.Number switch {
                    208 => "Banco de dados: uma tabela necessária não foi encontrada.",
                    207 => "Banco de dados: a estrutura de uma tabela está incompatível.",
                    229 => "Banco de dados: faltam permissões para gravar.",
                    2601 or 2627 => "Banco de dados: registro duplicado.",
                    515 => "Banco de dados: um campo obrigatório está ausente na gravação.",
                    547 => "Banco de dados: violação de relacionamento entre registros.",
                    8152 or 2628 => "Banco de dados: um valor ultrapassou o tamanho permitido.",
                    1205 => "Banco de dados: conflito de transações.",
                    -2 => "Banco de dados: tempo limite de resposta excedido.",
                    _ => "Banco de dados: falha ao executar a operação."
                };
                // Only a signed-in administrator can see the numeric SQL error code.
                if(User.IsInRole("ADMIN"))ViewData["SqlErrorCode"]=sql.Number;
            }
        }
        return View();
    }
}