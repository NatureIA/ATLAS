using Atlas.Data;
using Atlas.Domain;
using Atlas.Services;
using Atlas.ViewModels;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Atlas.Controllers;
[Authorize]
public class GoalsController(FinanceDbContext db,CurrentUser current,AuditService audit) : Controller {
    [HttpGet] public async Task<IActionResult> Index(){
        ViewBag.Goals=await db.Goals.AsNoTracking().Where(x=>x.UserId==current.Id)
            .OrderByDescending(x=>x.Id).ToListAsync();return View(new GoalInput());
    }
    [HttpPost,ValidateAntiForgeryToken] public async Task<IActionResult> Create(GoalInput input){
        if(!ModelState.IsValid||input.TargetAmount<=0){TempData["Error"]="Informe uma meta válida.";return RedirectToAction("Index");}
        var goal=new FinancialGoal{UserId=current.Id,Name=input.Name.Trim(),TargetAmount=input.TargetAmount,
            CurrentAmount=0,Deadline=input.Deadline?.Date};db.Goals.Add(goal);
        await db.SaveChangesAsync();audit.Add("CREATE","FinancialGoal",goal.Id,new{goal.TargetAmount,goal.Deadline});
        await db.SaveChangesAsync();TempData["Success"]="Meta adicionada.";return RedirectToAction("Index");
    }
    [HttpPost,ValidateAntiForgeryToken] public async Task<IActionResult> Delete(int id){
        var goal=await db.Goals.FirstOrDefaultAsync(x=>x.Id==id&&x.UserId==current.Id);
        if(goal is null)return NotFound();db.Goals.Remove(goal);audit.Add("DELETE","FinancialGoal",id,new{goal.Name});
        await db.SaveChangesAsync();return RedirectToAction("Index");
    }
}