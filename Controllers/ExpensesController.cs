using Atlas.Data;
using Atlas.Domain;
using Atlas.Services;
using Atlas.ViewModels;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Data;

namespace Atlas.Controllers;
[Authorize]
public class ExpensesController(FinanceDbContext db,CurrentUser current,AuditService audit,RecurringService recurrence) : Controller {
    public static readonly string[] DefaultCategories=["Alimentação","Aluguel","Compras","Contabilidade","Energia","Impostos","Infraestrutura","Marketing","Material","Outros","Serviços","Software","Transporte"];
    private static readonly string[] Methods=["Pix","Dinheiro","Débito","Crédito","Transferência","Boleto"];
    private async Task Options(ExpenseInput vm){
        var existing=await db.Expenses.AsNoTracking().Where(x=>x.UserId==current.Id).Select(x=>x.Category).Distinct().ToListAsync();
        vm.Categories=DefaultCategories.Concat(existing).Concat(new[]{vm.Category}).Where(x=>!string.IsNullOrWhiteSpace(x)).Distinct().OrderBy(x=>x).ToList();
    }
    [HttpGet] public async Task<IActionResult> Index(string? search,string? status,string? category,string? expenseType,string? paymentMethod,int? year,int? month){
        if(year is < 2000 or > 2100 || month is < 1 or > 12)return BadRequest();
        if(year.HasValue||month.HasValue)await recurrence.EnsureThroughAsync(current.Id,
            new DateTime(year??DateTime.Today.Year,month??12,1));
        var q=db.Expenses.AsNoTracking().Where(x=>x.UserId==current.Id);
        if(year.HasValue)q=q.Where(x=>x.Date.Year==year);
        if(month.HasValue)q=q.Where(x=>x.Date.Month==month);
        if(!string.IsNullOrWhiteSpace(search))q=q.Where(x=>x.Description.Contains(search.Trim()));
        if(status=="paid")q=q.Where(x=>x.Paid);
        if(status=="pending")q=q.Where(x=>!x.Paid);
        if(!string.IsNullOrWhiteSpace(category))q=q.Where(x=>x.Category==category);
        if(!string.IsNullOrWhiteSpace(expenseType))q=q.Where(x=>x.ExpenseType==expenseType);
        if(!string.IsNullOrWhiteSpace(paymentMethod))q=q.Where(x=>x.PaymentMethod==paymentMethod);
        var rows=await q.OrderByDescending(x=>x.Date).ThenByDescending(x=>x.Id).Take(500).ToListAsync();
        var categories=await db.Expenses.AsNoTracking().Where(x=>x.UserId==current.Id).Select(x=>x.Category).Distinct().OrderBy(x=>x).ToListAsync();
        var activeSeries=await db.ExpenseSeries.AsNoTracking().Where(x=>x.UserId==current.Id&&x.Active).Select(x=>x.Id).ToListAsync();
        return View(new ExpenseListVm{Rows=rows,Search=search,Status=status,Category=category,Year=year,Month=month,
            Categories=categories,ActiveSeries=activeSeries.ToHashSet(),ExpenseType=expenseType,PaymentMethod=paymentMethod});
    }
    [HttpGet] public async Task<IActionResult> Create(){var vm=new ExpenseInput();await Options(vm);return View("Form",vm);}
    [HttpPost,ValidateAntiForgeryToken] public async Task<IActionResult> Save(ExpenseInput input){
        Validate(input,true);
        if(!ModelState.IsValid){await Options(input);return View("Form",input);}
        var category=input.Category=="__new__"?input.NewCategory!.Trim():input.Category;
        var today=DateTime.Today;
        await using var tx=await db.Database.BeginTransactionAsync();
        var isInstallment=!input.IsRecurring&&(input.PaymentMethod=="Crédito"||input.PaymentMethod=="Boleto");
        if(input.IsRecurring){
            var start=input.PaymentMethod switch {
                "Crédito"=>today.AddMonths(1),"Boleto"=>input.FirstBillDate!.Value.Date,_=>today};
            var series=new RecurringExpenseSeries{UserId=current.Id,Description=input.Description.Trim(),Category=category,
                ExpenseType=input.ExpenseType,Amount=input.Amount,PaymentMethod=input.PaymentMethod,
                StartDate=start,Notes=input.Notes};
            db.ExpenseSeries.Add(series);
            recurrence.Revision(current.Id,series.Id,"expense",start,new ExpenseSnapshot(series.Description,
                series.Category,series.ExpenseType,series.Amount,series.PaymentMethod,series.Notes));
            db.Expenses.Add(New(input,category,start,false,series.Id,RecurringService.Key(start)));
            // Em pagamento comum respeita a indicação Já paga na ocorrência inicial.
            if(input.PaymentMethod is not ("Crédito" or "Boleto"))db.Expenses.Local.Last().Paid=input.Paid;
            audit.Add("CREATE","RecurringExpenseSeries",series.Id,new{input.Amount,start,category});
        } else if(isInstallment){
            var group=Guid.NewGuid();var first=input.PaymentMethod=="Crédito"?today.AddMonths(1):input.FirstBillDate!.Value.Date;
            for(var i=0;i<input.Installments;i++){
                var date=RecurringService.OccurrenceDate(first,new DateTime(first.Year,first.Month,1).AddMonths(i));
                var entry=New(input,category,date,false,null,null);
                entry.InstallmentGroupId=group;entry.InstallmentNumber=i+1;entry.InstallmentTotal=input.Installments;
                db.Expenses.Add(entry);
            }
            audit.Add("CREATE","ExpenseInstallments",group,new{input.Amount,input.Installments,first,category});
        } else {
            var entry=New(input,category,today,input.Paid,null,null);db.Expenses.Add(entry);
            audit.Add("CREATE","ExpenseEntry","new",new{input.Amount,category});
        }
        await db.SaveChangesAsync();await tx.CommitAsync();TempData["Success"]="Despesa registrada.";
        return RedirectToAction("Index");
    }
    [HttpGet] public async Task<IActionResult> Edit(long id){
        var x=await db.Expenses.AsNoTracking().FirstOrDefaultAsync(x=>x.Id==id&&x.UserId==current.Id);
        if(x is null)return NotFound();
        if(x.InstallmentGroupId is Guid groupId)return RedirectToAction(nameof(Installments),new{id=groupId});
        var vm=new ExpenseInput{Id=x.Id,Description=x.Description,Category=x.Category,ExpenseType=x.ExpenseType,
            Amount=x.Amount,PaymentMethod=x.PaymentMethod,Paid=x.Paid,Notes=x.Notes,ExistingRecurring=x.RecurringSeriesId!=null};
        await Options(vm);return View("Form",vm);
    }
    [HttpPost,ValidateAntiForgeryToken] public async Task<IActionResult> Update(long id,ExpenseInput input){
        Validate(input,false);
        if(!ModelState.IsValid){input.Id=id;await Options(input);return View("Form",input);}
        var row=await db.Expenses.FirstOrDefaultAsync(x=>x.Id==id&&x.UserId==current.Id);
        if(row is null)return NotFound();
        if(row.InstallmentGroupId is Guid groupId)return RedirectToAction(nameof(Installments),new{id=groupId});
        var cat=input.Category=="__new__"?input.NewCategory!.Trim():input.Category;
        await using var tx=await db.Database.BeginTransactionAsync();
        if(row.RecurringSeriesId is Guid seriesId){
            var series=await db.ExpenseSeries.FirstOrDefaultAsync(x=>x.Id==seriesId&&x.UserId==current.Id);
            if(series is null)return NotFound();
            var future=await db.Expenses.Where(x=>x.UserId==current.Id&&x.RecurringSeriesId==seriesId&&x.Date>=row.Date).ToListAsync();
            foreach(var entry in future)Apply(entry,input,cat,false);
            row.Paid=input.Paid;
            series.Description=input.Description.Trim();series.Category=cat;series.ExpenseType=input.ExpenseType;
            series.Amount=input.Amount;series.PaymentMethod=input.PaymentMethod;series.Notes=input.Notes;series.UpdatedAt=DateTime.UtcNow;
            recurrence.Revision(current.Id,seriesId,"expense",row.Date,new ExpenseSnapshot(series.Description,
                cat,input.ExpenseType,input.Amount,input.PaymentMethod,input.Notes));
            audit.Add("UPDATE","RecurringExpenseSeries",seriesId,new{effective=row.Date,input.Amount,cat});
        } else {Apply(row,input,cat,true);audit.Add("UPDATE","ExpenseEntry",id,new{input.Amount,cat,input.Paid});}
        await db.SaveChangesAsync();await tx.CommitAsync();TempData["Success"]="Despesa atualizada.";return RedirectToAction("Index");
    }

    // A group represents one purchase. Editing it updates every still-unpaid
    // installment atomically, while never rewriting paid amounts or dates.
    [HttpGet] public async Task<IActionResult> Installments(Guid id){
        var rows=await db.Expenses.AsNoTracking()
            .Where(x=>x.UserId==current.Id&&x.InstallmentGroupId==id)
            .OrderBy(x=>x.InstallmentNumber).ToListAsync();
        if(rows.Count==0)return NotFound();
        var initial=rows.FirstOrDefault(x=>!x.Paid)??rows[0];
        var first=rows[0];
        var vm=new InstallmentGroupInput {
            GroupId=id,Description=initial.Description,Category=initial.Category,
            ExpenseType=initial.ExpenseType,Amount=initial.Amount,
            PaymentMethod=initial.PaymentMethod,Notes=initial.Notes,
            FirstInstallmentDate=first.Date,Installments=rows.Max(x=>x.InstallmentTotal??rows.Count)
        };
        await PopulateInstallmentOptions(vm,rows);
        return View(vm);
    }

    [HttpPost,ValidateAntiForgeryToken]
    public async Task<IActionResult> SaveInstallments(Guid id,InstallmentGroupInput input){
        input.GroupId=id;
        if(input.PaymentMethod is not ("Crédito" or "Boleto"))
            ModelState.AddModelError(nameof(input.PaymentMethod),"O parcelamento deve permanecer como Crédito ou Boleto.");
        if(input.ExpenseType is not ("Fixa" or "Variável"))
            ModelState.AddModelError(nameof(input.ExpenseType),"Tipo de despesa inválido.");
        if(input.Category=="__new__"&&string.IsNullOrWhiteSpace(input.NewCategory))
            ModelState.AddModelError(nameof(input.NewCategory),"Informe a nova categoria.");
        if(input.FirstInstallmentDate.Year is < 2000 or > 2100)
            ModelState.AddModelError(nameof(input.FirstInstallmentDate),"Informe uma data válida.");

        await using var tx=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
        var rows=await db.Expenses.Where(x=>x.UserId==current.Id&&x.InstallmentGroupId==id)
            .OrderBy(x=>x.InstallmentNumber).ToListAsync();
        if(rows.Count==0)return NotFound();
        if(rows.Any(x=>x.InstallmentNumber is null)||
           !rows.Select(x=>x.InstallmentNumber!.Value).SequenceEqual(Enumerable.Range(1,rows.Count))){
            ModelState.AddModelError("","Este parcelamento tem parcelas ausentes ou fora de sequência. Nenhum registro foi alterado.");
        }
        var paid=rows.Where(x=>x.Paid).ToList();
        var lastPaid=paid.Count==0?0:paid.Max(x=>x.InstallmentNumber!.Value);
        if(input.Installments<lastPaid)
            ModelState.AddModelError(nameof(input.Installments),
                $"Não é possível reduzir para {input.Installments}: a parcela {lastPaid} já está paga.");
        if(input.Installments>0&&input.FirstInstallmentDate.Year is >= 2000 and <= 2100){
            for(var n=lastPaid+1;n<=input.Installments;n++){
                var date=RecurringService.OccurrenceDate(input.FirstInstallmentDate,
                    new DateTime(input.FirstInstallmentDate.Year,input.FirstInstallmentDate.Month,1).AddMonths(n-1));
                if(paid.Any(x=>x.Date>=date)){
                    ModelState.AddModelError(nameof(input.FirstInstallmentDate),
                        "A nova data colocaria parcelas pendentes antes de um pagamento já realizado.");
                    break;
                }
            }
        }
        if(!ModelState.IsValid){
            await PopulateInstallmentOptions(input,rows);
            return View("Installments",input);
        }

        var category=input.Category=="__new__"?input.NewCategory!.Trim():input.Category.Trim();
        var oldCount=rows.Count;
        var oldAmount=rows.Where(x=>!x.Paid).Select(x=>(decimal?)x.Amount).FirstOrDefault()
            ??rows[0].Amount;
        var oldFirstDate=rows[0].Date;
        var byNumber=rows.ToDictionary(x=>x.InstallmentNumber!.Value);
        var removed=0;
        var created=0;
        for(var number=1;number<=Math.Max(oldCount,input.Installments);number++){
            byNumber.TryGetValue(number,out var existing);
            if(number>input.Installments){
                if(existing is not null&&!existing.Paid){db.Expenses.Remove(existing);removed++;}
                continue;
            }
            var date=RecurringService.OccurrenceDate(input.FirstInstallmentDate,
                new DateTime(input.FirstInstallmentDate.Year,input.FirstInstallmentDate.Month,1).AddMonths(number-1));
            if(existing is null){
                db.Expenses.Add(new ExpenseEntry {
                    UserId=current.Id,InstallmentGroupId=id,InstallmentNumber=number,
                    InstallmentTotal=input.Installments,Description=input.Description.Trim(),
                    Category=category,ExpenseType=input.ExpenseType,Amount=input.Amount,
                    PaymentMethod=input.PaymentMethod,Date=date,Paid=false,Notes=input.Notes,
                    CreatedAt=DateTime.UtcNow
                });
                created++;
            } else {
                // Paid installments retain all their original financial details.
                existing.InstallmentTotal=input.Installments;
                if(existing.Paid)continue;
                existing.Description=input.Description.Trim();
                existing.Category=category;
                existing.ExpenseType=input.ExpenseType;
                existing.Amount=input.Amount;
                existing.PaymentMethod=input.PaymentMethod;
                existing.Date=date;
                existing.Notes=input.Notes;
            }
        }
        audit.Add("UPDATE","ExpenseInstallments",id,new {
            PreviousCount=oldCount,NewCount=input.Installments,
            PreviousPendingAmount=oldAmount,NewPendingAmount=input.Amount,
            PreviousFirstDate=oldFirstDate,NewFirstDate=input.FirstInstallmentDate,
            PaidProtected=paid.Count,Created=created,Removed=removed,
            Category=category,PaymentMethod=input.PaymentMethod
        });
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        TempData["Success"]=$"Parcelamento atualizado. {created} parcela(s) adicionada(s), {removed} removida(s). Pagamentos existentes preservados.";
        return RedirectToAction(nameof(Index));
    }

    private async Task PopulateInstallmentOptions(InstallmentGroupInput input,List<ExpenseEntry> rows){
        input.CurrentInstallments=rows.Count;
        input.PaidCount=rows.Count(x=>x.Paid);
        input.LastPaidNumber=rows.Where(x=>x.Paid).Select(x=>x.InstallmentNumber??0).DefaultIfEmpty(0).Max();
        input.PaidAmountTotal=rows.Where(x=>x.Paid).Sum(x=>x.Amount);
        var existing=await db.Expenses.AsNoTracking().Where(x=>x.UserId==current.Id)
            .Select(x=>x.Category).Distinct().ToListAsync();
        input.Categories=DefaultCategories.Concat(existing)
            .Concat(new[]{input.Category}).Where(x=>!string.IsNullOrWhiteSpace(x)&&x!="__new__")
            .Distinct().OrderBy(x=>x).ToList();
    }

    [HttpPost,ValidateAntiForgeryToken] public async Task<IActionResult> Pay(long id){
        var row=await db.Expenses.FirstOrDefaultAsync(x=>x.Id==id&&x.UserId==current.Id);
        if(row is null)return NotFound();
        if(!row.Paid){row.Paid=true;audit.Add("PAY","ExpenseEntry",row.Id,new{row.Amount,row.Date});await db.SaveChangesAsync();}
        TempData["Success"]="Pagamento registrado.";return RedirectToAction("Index");
    }
    [HttpPost,ValidateAntiForgeryToken] public async Task<IActionResult> Delete(long id){
        var row=await db.Expenses.FirstOrDefaultAsync(x=>x.Id==id&&x.UserId==current.Id);
        if(row is null)return NotFound();
        if(row.InstallmentGroupId!=null){TempData["Error"]="Para excluir ou ajustar parcelas, use Gerenciar parcelamento.";return RedirectToAction("Index");}
        if(row.RecurringSeriesId!=null){TempData["Error"]="Para despesas recorrentes, encerre a série.";return RedirectToAction("Index");}
        db.Expenses.Remove(row);audit.Add("DELETE","ExpenseEntry",id,new{row.Amount,row.Description});
        await db.SaveChangesAsync();TempData["Success"]="Despesa excluída.";return RedirectToAction("Index");
    }
    [HttpPost,ValidateAntiForgeryToken] public async Task<IActionResult> End(Guid id){
        if(!await db.ExpenseSeries.AnyAsync(x=>x.UserId==current.Id&&x.Id==id&&x.Active))return NotFound();
        await recurrence.EndExpenseAsync(current.Id,id);TempData["Success"]="Recorrência encerrada.";return RedirectToAction("Index");
    }
    private void Validate(ExpenseInput x,bool create){
        if(!Methods.Contains(x.PaymentMethod))ModelState.AddModelError(nameof(x.PaymentMethod),"Forma de pagamento inválida.");
        if(x.ExpenseType is not("Fixa" or "Variável"))ModelState.AddModelError(nameof(x.ExpenseType),"Tipo de despesa inválido.");
        if(x.Category=="__new__"&&string.IsNullOrWhiteSpace(x.NewCategory))ModelState.AddModelError(nameof(x.NewCategory),"Informe a nova categoria.");
        if(create&&x.PaymentMethod=="Boleto"&&x.FirstBillDate is null)ModelState.AddModelError(nameof(x.FirstBillDate),"Informe a data do primeiro boleto.");
        if(create&&!x.IsRecurring&&(x.PaymentMethod is "Crédito" or "Boleto")&&(x.Installments is < 1 or > 120))
            ModelState.AddModelError(nameof(x.Installments),"Informe entre 1 e 120 parcelas.");
    }
    private ExpenseEntry New(ExpenseInput x,string category,DateTime date,bool paid,Guid? series,string? key) =>
        new(){UserId=current.Id,Description=x.Description.Trim(),Category=category,ExpenseType=x.ExpenseType,
            Amount=x.Amount,PaymentMethod=x.PaymentMethod,Date=date,DueDate=null,Paid=paid,
            Notes=x.Notes,RecurringSeriesId=series,RecurringOccurrenceKey=key};
    private static void Apply(ExpenseEntry e,ExpenseInput x,string category,bool includePaid){
        e.Description=x.Description.Trim();e.Category=category;e.ExpenseType=x.ExpenseType;
        e.Amount=x.Amount;e.PaymentMethod=x.PaymentMethod;e.Notes=x.Notes;
        if(includePaid)e.Paid=x.Paid;
    }
}