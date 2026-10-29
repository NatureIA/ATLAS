using Atlas.Data;
using Atlas.Domain;
using Atlas.Services;
using Atlas.ViewModels;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Atlas.Controllers;
[Authorize]
public class RevenueController(FinanceDbContext db,CurrentUser current,AuditService audit,RecurringService recurrence) : Controller {
    private static readonly string[] Methods=["Pix","Dinheiro","Débito","Crédito","Transferência"];
    private async Task Options(RevenueInput input){input.Items=await db.RevenueItems.AsNoTracking().Where(x=>x.UserId==current.Id).OrderByDescending(x=>x.Active).ThenBy(x=>x.Name).ToListAsync();}
    [HttpGet]
    public async Task<IActionResult> Index(string? search,string? paymentMethod,int? year,int? month){
        var q=db.Revenues.AsNoTracking().Where(x=>x.UserId==current.Id);
        if(year is not null){if(year is < 2000 or > 2100)return BadRequest();q=q.Where(x=>x.Date.Year==year);}
        if(month is not null){if(month is < 1 or > 12)return BadRequest();q=q.Where(x=>x.Date.Month==month);}
        if(!string.IsNullOrWhiteSpace(search)){var s=search.Trim();q=q.Where(x=>x.RevenueItemName.Contains(s)||(x.ReferenceName!=null&&x.ReferenceName.Contains(s)));}
        if(!string.IsNullOrWhiteSpace(paymentMethod))q=q.Where(x=>x.PaymentMethod==paymentMethod);
        if(year.HasValue||month.HasValue)await recurrence.EnsureThroughAsync(current.Id,
            new DateTime(year??DateTime.Today.Year,month??12,1));
        var rows=await q.OrderByDescending(x=>x.Date).ThenByDescending(x=>x.Id).Take(500).ToListAsync();
        return View(new RevenueListVm{Rows=rows,Search=search,PaymentMethod=paymentMethod,Year=year,Month=month});
    }
    [HttpGet] public async Task<IActionResult> Create(){var vm=new RevenueInput();await Options(vm);return View("Form",vm);}
    [HttpPost,ValidateAntiForgeryToken]
    public async Task<IActionResult> Save(RevenueInput input){
        Validate(input);if(!ModelState.IsValid){await Options(input);return View("Form",input);}
        var name=input.ItemName=="__new__"?input.NewItemName!.Trim():input.ItemName.Trim();
        await using var tx=await db.Database.BeginTransactionAsync();
        await ActivateItem(name);
        Guid? id=null;
        if(input.IsRecurring){
            var serie=new RecurringRevenueSeries{UserId=current.Id,RevenueItemName=name,Amount=input.Amount,
                PaymentMethod=input.PaymentMethod,ReferenceName=input.ReferenceName,Notes=input.Notes,StartDate=DateTime.Today};
            db.RevenueSeries.Add(serie);id=serie.Id;
            recurrence.Revision(current.Id,serie.Id,"revenue",serie.StartDate,
                new RevenueSnapshot(name,input.Amount,input.PaymentMethod,input.ReferenceName,input.Notes));
        }
        var entry=new RevenueEntry{UserId=current.Id,RevenueItemName=name,Amount=input.Amount,
            PaymentMethod=input.PaymentMethod,ReferenceName=input.ReferenceName,Notes=input.Notes,Date=DateTime.Today,
            RecurringSeriesId=id,RecurringOccurrenceKey=id is null?null:RecurringService.Key(DateTime.Today)};
        db.Revenues.Add(entry);
        await db.SaveChangesAsync();
        audit.Add("CREATE","RevenueEntry",entry.Id,new {name,input.Amount,input.PaymentMethod,input.IsRecurring,SeriesId=id});
        await db.SaveChangesAsync();await tx.CommitAsync();TempData["Success"]="Receita registrada.";
        return RedirectToAction("Index");
    }
    [HttpGet] public async Task<IActionResult> Edit(long id){
        var row=await db.Revenues.AsNoTracking().FirstOrDefaultAsync(x=>x.Id==id&&x.UserId==current.Id);
        if(row is null)return NotFound();
        var vm=new RevenueInput{Id=row.Id,ItemName=row.RevenueItemName,Amount=row.Amount,PaymentMethod=row.PaymentMethod,
            ReferenceName=row.ReferenceName,Notes=row.Notes,ExistingRecurring=row.RecurringSeriesId is not null};
        await Options(vm);return View("Form",vm);
    }
    [HttpPost,ValidateAntiForgeryToken]
    public async Task<IActionResult> Update(long id,RevenueInput input){
        Validate(input);if(!ModelState.IsValid){input.Id=id;await Options(input);return View("Form",input);}
        var row=await db.Revenues.FirstOrDefaultAsync(x=>x.Id==id&&x.UserId==current.Id);
        if(row is null)return NotFound();
        var name=input.ItemName=="__new__"?input.NewItemName!.Trim():input.ItemName.Trim();
        await using var tx=await db.Database.BeginTransactionAsync();
        await ActivateItem(name);
        if(row.RecurringSeriesId is Guid seriesId){
            var serie=await db.RevenueSeries.FirstOrDefaultAsync(x=>x.Id==seriesId&&x.UserId==current.Id);
            if(serie is null)return NotFound();
            var future=await db.Revenues.Where(x=>x.UserId==current.Id&&x.RecurringSeriesId==seriesId&&x.Date>=row.Date).ToListAsync();
            foreach(var entry in future)Apply(entry,name,input);
            serie.RevenueItemName=name;serie.Amount=input.Amount;serie.PaymentMethod=input.PaymentMethod;
            serie.ReferenceName=input.ReferenceName;serie.Notes=input.Notes;serie.UpdatedAt=DateTime.UtcNow;
            recurrence.Revision(current.Id,seriesId,"revenue",row.Date,
                new RevenueSnapshot(name,input.Amount,input.PaymentMethod,input.ReferenceName,input.Notes));
            audit.Add("UPDATE","RecurringRevenueSeries",seriesId,new {effective=row.Date,input.Amount,name});
        } else {Apply(row,name,input);audit.Add("UPDATE","RevenueEntry",row.Id,new {input.Amount,name});}
        await db.SaveChangesAsync();await tx.CommitAsync();TempData["Success"]="Receita atualizada.";
        return RedirectToAction("Index");
    }
    [HttpPost,ValidateAntiForgeryToken] public async Task<IActionResult> Delete(long id){
        var entry=await db.Revenues.FirstOrDefaultAsync(x=>x.Id==id&&x.UserId==current.Id);
        if(entry is null)return NotFound();
        if(entry.RecurringSeriesId!=null){TempData["Error"]="Para uma receita recorrente, encerre a série.";return RedirectToAction("Index");}
        db.Revenues.Remove(entry);audit.Add("DELETE","RevenueEntry",id,new{entry.RevenueItemName,entry.Amount});
        await db.SaveChangesAsync();TempData["Success"]="Receita excluída.";return RedirectToAction("Index");
    }
    [HttpPost,ValidateAntiForgeryToken] public async Task<IActionResult> End(Guid id){
        var serie=await db.RevenueSeries.AsNoTracking().FirstOrDefaultAsync(x=>x.Id==id&&x.UserId==current.Id&&x.Active);
        if(serie is null)return NotFound();
        await recurrence.EndRevenueAsync(current.Id,id);TempData["Success"]="Recorrência encerrada.";return RedirectToAction("Index");
    }
    private void Validate(RevenueInput input){
        if(!Methods.Contains(input.PaymentMethod))ModelState.AddModelError(nameof(input.PaymentMethod),"Forma de recebimento inválida.");
        if(input.ItemName=="__new__"&&string.IsNullOrWhiteSpace(input.NewItemName))ModelState.AddModelError(nameof(input.NewItemName),"Informe o novo item.");
    }
    private async Task ActivateItem(string name){
        var item=await db.RevenueItems.FirstOrDefaultAsync(x=>x.UserId==current.Id&&x.Name==name);
        if(item is null)db.RevenueItems.Add(new RevenueItem{UserId=current.Id,Name=name,Price=0,Active=true});
        else item.Active=true;
    }
    private static void Apply(RevenueEntry e,string name,RevenueInput i){
        e.RevenueItemName=name;e.Amount=i.Amount;e.PaymentMethod=i.PaymentMethod;
        e.ReferenceName=i.ReferenceName;e.Notes=i.Notes;
    }
}