using Atlas.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Atlas.Controllers;
[Authorize]
public class HomeController(FinancialService finance,CurrentUser user) : Controller {
    [HttpGet] public async Task<IActionResult> Index(int? year,int? month){
        var y=year??DateTime.Today.Year;var m=month??DateTime.Today.Month;
        if(y is < 2000 or > 2100 || m is < 1 or > 12)return BadRequest("Competência inválida.");
        return View(await finance.DashboardAsync(user.Id,y,m));
    }
    [AllowAnonymous,HttpGet]
    public IActionResult Error() => View();
}