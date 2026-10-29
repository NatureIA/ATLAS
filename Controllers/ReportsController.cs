using Atlas.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Atlas.Controllers;
[Authorize]
public class ReportsController(FinancialService finance,CurrentUser user) : Controller {
    [HttpGet] public async Task<IActionResult> Index(int? year){
        var y=year??DateTime.Today.Year;
        if(y is < 2000 or > 2100)return BadRequest("Ano inválido.");
        return View(await finance.ReportAsync(user.Id,y));
    }
}