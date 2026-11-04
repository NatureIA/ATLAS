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
    private static DateTime TodayBrasilia() => TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow,
        TimeZoneInfo.FindSystemTimeZoneById("America/Sao_Paulo")).Date;

    [HttpGet]
    public async Task<IActionResult> Index(string? search,string? paymentMethod,int? year,int? month,string? status,string? group){
        if(year is < 2000 or > 2100 || month is < 0 or > 12)return BadRequest();
        if(status is not (null or "" or "received" or "pending"))return BadRequest();
        if(group is not (null or "" or "received" or "pending" or "overdue" or "next7"))return BadRequest();
        var today=TodayBrasilia();
        var selectedYear=year??today.Year;
        var selectedMonth=month??today.Month;
        var fullYear=selectedMonth==0;
        var first=new DateTime(selectedYear,fullYear?1:selectedMonth,1);
        var next=fullYear?first.AddYears(1):first.AddMonths(1);
        await recurrence.EnsureThroughAsync(current.Id,next.AddDays(-1));
        var competence=db.Revenues.AsNoTracking().Where(x=>x.UserId==current.Id && x.Date>=first && x.Date<next);
        var pending=await competence.Select(x=>new {x.Received,x.ExpectedReceiptDate,x.Amount}).ToListAsync();
        var seven=today.AddDays(7);
        var buckets=new List<ReceiptBucketVm>();
        void AddBucket(string key,string label,Func<bool,DateTime?,bool> match){
            var matched=pending.Where(x=>match(x.Received,x.ExpectedReceiptDate)).ToList();
            buckets.Add(new ReceiptBucketVm(key,label,matched.Count,matched.Sum(x=>x.Amount)));
        }
        AddBucket("received","Recebido",(received,expected)=>received);
        AddBucket("pending","A receber",(received,expected)=>!received);
        AddBucket("overdue","Em atraso",(received,expected)=>!received && expected<today);
        AddBucket("next7","Próximos 7 dias",(received,expected)=>!received && expected>=today && expected<=seven);
        var q=competence;
        if(!string.IsNullOrWhiteSpace(search)){
            var term=search.Trim();
            q=q.Where(x=>x.RevenueItemName.Contains(term)||(x.ReferenceName!=null&&x.ReferenceName.Contains(term)));
        }
        if(!string.IsNullOrWhiteSpace(paymentMethod))q=q.Where(x=>x.PaymentMethod==paymentMethod);
        if(status=="received")q=q.Where(x=>x.Received);
        if(status=="pending")q=q.Where(x=>!x.Received);
        if(!string.IsNullOrWhiteSpace(group)){
            q=group switch {
                "received"=>q.Where(x=>x.Received),
                "pending"=>q.Where(x=>!x.Received),
                "overdue"=>q.Where(x=>!x.Received && x.ExpectedReceiptDate<today),
                "next7"=>q.Where(x=>!x.Received && x.ExpectedReceiptDate>=today && x.ExpectedReceiptDate<=seven),
                _=>q
            };
        }
        var rows=await q.OrderByDescending(x=>x.Date).ThenByDescending(x=>x.Id).Take(500).ToListAsync();
        return View(new RevenueListVm{Rows=rows,Search=search,PaymentMethod=paymentMethod,
            Year=selectedYear,Month=selectedMonth,Today=today,Status=status,Group=group,Buckets=buckets});
    }
    [HttpGet] public async Task<IActionResult> Create(){var vm=new RevenueInput();await Options(vm);return View("Form",vm);}
    [HttpPost,ValidateAntiForgeryToken]
    public async Task<IActionResult> Save(RevenueInput input){
        Validate(input,true);if(!ModelState.IsValid){await Options(input);return View("Form",input);}
        var name=input.ItemName=="__new__"?input.NewItemName!.Trim():input.ItemName.Trim();
        await using var tx=await db.Database.BeginTransactionAsync();
        await ActivateItem(name);
        Guid? id=null;
        if(input.IsRecurring){
            var serie=new RecurringRevenueSeries{UserId=current.Id,RevenueItemName=name,Amount=input.Amount,
                PaymentMethod=input.PaymentMethod,ReferenceName=input.ReferenceName,Notes=input.Notes,StartDate=TodayBrasilia(),ReceiptDay=input.ExpectedReceiptDate?.Day,
                ReceiptMonthOffset=input.ExpectedReceiptDate.HasValue ? (input.ExpectedReceiptDate.Value.Year-TodayBrasilia().Year)*12+input.ExpectedReceiptDate.Value.Month-TodayBrasilia().Month : 0,
                FutureReceived=false};
            db.RevenueSeries.Add(serie);id=serie.Id;
            recurrence.Revision(current.Id,serie.Id,"revenue",serie.StartDate,
                new RevenueSnapshot(name,input.Amount,input.PaymentMethod,input.ReferenceName,input.Notes,
                    serie.ReceiptDay,serie.ReceiptMonthOffset,serie.FutureReceived));
        }
        var entry=new RevenueEntry{UserId=current.Id,RevenueItemName=name,Amount=input.Amount,
            PaymentMethod=input.PaymentMethod,ReferenceName=input.ReferenceName,Notes=input.Notes,Date=TodayBrasilia(),Received=input.Received,ExpectedReceiptDate=input.ExpectedReceiptDate?.Date,
            ReceivedDate=input.Received?(input.ReceivedDate?.Date??TodayBrasilia()):null,
            RecurringSeriesId=id,RecurringOccurrenceKey=id is null?null:RecurringService.Key(TodayBrasilia())};
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
            ReferenceName=row.ReferenceName,Notes=row.Notes,Received=row.Received,ExpectedReceiptDate=row.ExpectedReceiptDate,
            ReceivedDate=row.ReceivedDate,ExistingRecurring=row.RecurringSeriesId is not null};
        await Options(vm);return View("Form",vm);
    }
    [HttpPost,ValidateAntiForgeryToken]
    public async Task<IActionResult> Update(long id,RevenueInput input,string? scope){
        Validate(input);
        if(!ModelState.IsValid){input.Id=id;await Options(input);return View("Form",input);}
        var row=await db.Revenues.FirstOrDefaultAsync(x=>x.Id==id&&x.UserId==current.Id);
        if(row is null)return NotFound();
        if(row.RecurringSeriesId!=null && scope is not ("single" or "future")){
            ModelState.AddModelError("scope","Escolha se a alteração vale apenas para este mês ou também para os seguintes.");
            input.Id=id;input.ExistingRecurring=true;await Options(input);return View("Form",input);
        }
        var name=input.ItemName=="__new__"?input.NewItemName!.Trim():input.ItemName.Trim();
        await using var tx=await db.Database.BeginTransactionAsync();
        await ActivateItem(name);
        if(row.RecurringSeriesId is Guid seriesId){
            var serie=await db.RevenueSeries.FirstOrDefaultAsync(x=>x.Id==seriesId&&x.UserId==current.Id);
            if(serie is null)return NotFound();
            if(scope=="single"){
                Apply(row,name,input);
                audit.Add("UPDATE","RecurringRevenueOccurrence",row.Id,new {seriesId,month=RecurringService.Key(row.Date),scope,input.Amount,name});
            } else {
                var future=await db.Revenues.Where(x=>x.UserId==current.Id&&x.RecurringSeriesId==seriesId&&x.Date>=row.Date).ToListAsync();
                var monthOffset=input.ExpectedReceiptDate.HasValue ? (input.ExpectedReceiptDate.Value.Year-row.Date.Year)*12+input.ExpectedReceiptDate.Value.Month-row.Date.Month : 0;
                foreach(var entry in future){
                    // A recurring scope updates existing materialized months as well as
                    // future occurrences generated through SeriesRevision snapshots.
                    // Do not reuse one actual receipt date for different months.
                    Apply(entry,name,input,false);
                    entry.ExpectedReceiptDate=input.ExpectedReceiptDate.HasValue?
                        RecurringService.RecurringDueDate(entry.Date,input.ExpectedReceiptDate.Value.Day,monthOffset):null;
                    entry.Received=input.Received;
                    entry.ReceivedDate=entry.Id==row.Id
                        ?(input.Received?(input.ReceivedDate?.Date??(row.Received?row.ReceivedDate:TodayBrasilia())):null)
                        :null;
                }
                serie.FutureReceived=input.Received;
                serie.RevenueItemName=name;serie.Amount=input.Amount;serie.PaymentMethod=input.PaymentMethod;
                serie.ReferenceName=input.ReferenceName;serie.Notes=input.Notes;serie.UpdatedAt=DateTime.UtcNow;
                serie.ReceiptDay=input.ExpectedReceiptDate?.Day;serie.ReceiptMonthOffset=monthOffset;
                // Later revisions must not re-apply an older amount when future months are generated.
                var from=RecurringService.Month(row.Date);
                var later=await db.Revisions.Where(x=>x.UserId==current.Id&&x.SeriesId==seriesId&&x.Kind=="revenue"&&x.EffectiveMonth>from).ToListAsync();
                foreach(var revision in later)
                    recurrence.Revision(current.Id,seriesId,"revenue",revision.EffectiveMonth,
                        new RevenueSnapshot(name,input.Amount,input.PaymentMethod,input.ReferenceName,input.Notes,serie.ReceiptDay,serie.ReceiptMonthOffset,serie.FutureReceived));
                recurrence.Revision(current.Id,seriesId,"revenue",row.Date,
                    new RevenueSnapshot(name,input.Amount,input.PaymentMethod,input.ReferenceName,input.Notes,serie.ReceiptDay,serie.ReceiptMonthOffset,serie.FutureReceived));
                audit.Add("UPDATE","RecurringRevenueSeries",seriesId,new {effective=row.Date,scope,input.Amount,name,updatedFutureRevisions=later.Count});
            }
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
    private void Validate(RevenueInput input,bool create=false){
        if(input.ExpectedReceiptDate.HasValue && input.ExpectedReceiptDate.Value.Year is < 2000 or > 2100) ModelState.AddModelError(nameof(input.ExpectedReceiptDate),"Previsão inválida.");
        if(input.ReceivedDate.HasValue && input.ReceivedDate.Value.Year is < 2000 or > 2100) ModelState.AddModelError(nameof(input.ReceivedDate),"Data de recebimento inválida.");
        if(!input.Received && input.ExpectedReceiptDate==null)ModelState.AddModelError(nameof(input.ExpectedReceiptDate),"Informe a previsão de recebimento.");
        if(create && input.IsRecurring && input.ExpectedReceiptDate==null)ModelState.AddModelError(nameof(input.ExpectedReceiptDate),"Informe a previsão mensal para a receita recorrente.");
        if(!input.Received && input.ReceivedDate!=null)ModelState.AddModelError(nameof(input.ReceivedDate),"Somente receitas recebidas podem ter data de recebimento.");
        if(!Methods.Contains(input.PaymentMethod))ModelState.AddModelError(nameof(input.PaymentMethod),"Forma de recebimento inválida.");
        if(input.ItemName=="__new__"&&string.IsNullOrWhiteSpace(input.NewItemName))ModelState.AddModelError(nameof(input.NewItemName),"Informe o novo item.");
    }
    private async Task ActivateItem(string name){
        var item=await db.RevenueItems.FirstOrDefaultAsync(x=>x.UserId==current.Id&&x.Name==name);
        if(item is null)db.RevenueItems.Add(new RevenueItem{UserId=current.Id,Name=name,Price=0,Active=true});
        else item.Active=true;
    }
    [HttpPost,ValidateAntiForgeryToken]
    public async Task<IActionResult> Receive(long id){
        var row=await db.Revenues.FirstOrDefaultAsync(x=>x.Id==id&&x.UserId==current.Id);
        if(row is null)return NotFound();
        if(!row.Received){
            row.Received=true;row.ReceivedDate=TodayBrasilia();
            audit.Add("RECEIVE","RevenueEntry",row.Id,new{row.Amount,row.Date,row.ExpectedReceiptDate,row.ReceivedDate});
            await db.SaveChangesAsync();
        }
        TempData["Success"]="Recebimento confirmado.";
        return RedirectToAction(nameof(Index));
    }
    private static void Apply(RevenueEntry e,string name,RevenueInput i,bool includeReceipt=true){
        e.RevenueItemName=name;e.Amount=i.Amount;e.PaymentMethod=i.PaymentMethod;
        e.ReferenceName=i.ReferenceName;e.Notes=i.Notes;
        e.ExpectedReceiptDate=i.ExpectedReceiptDate?.Date;
        if(includeReceipt){
            if(i.Received && !e.Received)e.ReceivedDate=i.ReceivedDate?.Date??TodayBrasilia();
            else if(!i.Received)e.ReceivedDate=null;
            else if(i.ReceivedDate.HasValue)e.ReceivedDate=i.ReceivedDate.Value.Date;
            e.Received=i.Received;
        }
    }
}