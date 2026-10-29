using Atlas.Data;
using Atlas.Domain;
using Atlas.Services;
using Atlas.ViewModels;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Atlas.Controllers;
[Authorize]
public class ItemsController(FinanceDbContext db,CurrentUser current,AuditService audit) : Controller {
    [HttpGet] public async Task<IActionResult> Index(){
        ViewBag.Items=await db.RevenueItems.AsNoTracking().Where(x=>x.UserId==current.Id)
            .OrderByDescending(x=>x.Active).ThenBy(x=>x.Name).ToListAsync();
        return View(new ItemInput());
    }
    [HttpPost,ValidateAntiForgeryToken] public async Task<IActionResult> Save(ItemInput input){
        if(!ModelState.IsValid||input.Price<0){TempData["Error"]="Preencha os campos do item corretamente.";return RedirectToAction("Index");}
        var name=input.Name.Trim();
        if(input.Id is int id){
            var item=await db.RevenueItems.FirstOrDefaultAsync(x=>x.Id==id&&x.UserId==current.Id);
            if(item is null)return NotFound();
            if(await db.RevenueItems.AnyAsync(x=>x.UserId==current.Id&&x.Id!=id&&x.Name==name)){
                TempData["Error"]="Já existe outro item com esse nome.";return RedirectToAction("Index");}
            item.Name=name;item.Price=input.Price;item.Active=input.Active;
            audit.Add("UPDATE","RevenueItem",id,new {name,item.Active});
        } else {
            if(await db.RevenueItems.AnyAsync(x=>x.UserId==current.Id&&x.Name==name)){
                TempData["Error"]="Este item já está cadastrado.";return RedirectToAction("Index");}
            var item=new RevenueItem{UserId=current.Id,Name=name,Price=input.Price,Active=true};
            db.RevenueItems.Add(item);audit.Add("CREATE","RevenueItem",name);
        }
        await db.SaveChangesAsync();TempData["Success"]="Item salvo.";return RedirectToAction("Index");
    }
    [HttpPost,ValidateAntiForgeryToken] public async Task<IActionResult> Toggle(int id){
        var item=await db.RevenueItems.FirstOrDefaultAsync(x=>x.Id==id&&x.UserId==current.Id);
        if(item is null)return NotFound();item.Active=!item.Active;
        audit.Add("UPDATE","RevenueItem",id,new{item.Active});await db.SaveChangesAsync();return RedirectToAction("Index");
    }
    [HttpPost,ValidateAntiForgeryToken] public async Task<IActionResult> Delete(int id){
        var item=await db.RevenueItems.FirstOrDefaultAsync(x=>x.Id==id&&x.UserId==current.Id);
        if(item is null)return NotFound();db.RevenueItems.Remove(item);
        audit.Add("DELETE","RevenueItem",id,new{item.Name});await db.SaveChangesAsync();return RedirectToAction("Index");
    }
}