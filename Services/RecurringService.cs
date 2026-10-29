using System.Data;
using System.Text.Json;
using Atlas.Data;
using Atlas.Domain;
using Microsoft.EntityFrameworkCore;

namespace Atlas.Services;
public record RevenueSnapshot(string RevenueItemName,decimal Amount,string PaymentMethod,string? ReferenceName,string? Notes);
public record ExpenseSnapshot(string Description,string Category,string ExpenseType,decimal Amount,string PaymentMethod,string? Notes);
public sealed class RecurringService(FinanceDbContext db,AuditService audit) {
    public static DateTime Month(DateTime date) => new(date.Year,date.Month,1);
    public static string Key(DateTime date) => date.ToString("yyyy-MM",System.Globalization.CultureInfo.InvariantCulture);
    public static DateTime OccurrenceDate(DateTime anchor,DateTime month) =>
        new(month.Year,month.Month,Math.Min(anchor.Day,DateTime.DaysInMonth(month.Year,month.Month)));

    public void Revision(int userId,Guid id,string kind,DateTime effective,object snapshot) {
        var month=Month(effective);
        var current=db.Revisions.Local.FirstOrDefault(x=>x.UserId==userId&&x.SeriesId==id&&x.Kind==kind&&x.EffectiveMonth==month);
        if(current is null) {
            current=db.Revisions.FirstOrDefault(x=>x.UserId==userId&&x.SeriesId==id&&x.Kind==kind&&x.EffectiveMonth==month);
        }
        var json=JsonSerializer.Serialize(snapshot);
        if(current is null) db.Revisions.Add(new SeriesRevision {UserId=userId,SeriesId=id,Kind=kind,EffectiveMonth=month,SnapshotJson=json});
        else current.SnapshotJson=json;
    }

    public async Task EnsureThroughAsync(int userId,DateTime through,CancellationToken ct=default) {
        through=Month(through);
        var income=await db.RevenueSeries.Where(x=>x.UserId==userId&&x.StartDate<=through.AddMonths(1).AddDays(-1)).ToListAsync(ct);
        var expense=await db.ExpenseSeries.Where(x=>x.UserId==userId&&x.StartDate<=through.AddMonths(1).AddDays(-1)).ToListAsync(ct);
        if(income.Count+expense.Count==0)return;
        await using var tx=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);
        var ids=income.Select(x=>x.Id).Concat(expense.Select(x=>x.Id)).ToList();
        var revisions=await db.Revisions.AsNoTracking().Where(x=>x.UserId==userId&&ids.Contains(x.SeriesId)).OrderBy(x=>x.EffectiveMonth).ToListAsync(ct);
        var incomeIds=income.Select(x=>x.Id).ToList();
        var expenseIds=expense.Select(x=>x.Id).ToList();
        var incomeKeys=await db.Revenues.AsNoTracking().Where(x=>x.UserId==userId&&x.RecurringSeriesId!=null&&incomeIds.Contains(x.RecurringSeriesId.Value))
            .Select(x=>new{x.RecurringSeriesId,x.RecurringOccurrenceKey}).ToListAsync(ct);
        var expenseKeys=await db.Expenses.AsNoTracking().Where(x=>x.UserId==userId&&x.RecurringSeriesId!=null&&expenseIds.Contains(x.RecurringSeriesId.Value))
            .Select(x=>new{x.RecurringSeriesId,x.RecurringOccurrenceKey}).ToListAsync(ct);
        var seenRevenue=incomeKeys.Select(x=>$"{x.RecurringSeriesId}:{x.RecurringOccurrenceKey}").ToHashSet();
        var seenExpense=expenseKeys.Select(x=>$"{x.RecurringSeriesId}:{x.RecurringOccurrenceKey}").ToHashSet();
        foreach(var s in income) {
            var max=s.EndDate is { } end && Month(end)<through?Month(end):through;
            var rules=revisions.Where(x=>x.SeriesId==s.Id&&x.Kind=="revenue").ToList();
            for(var m=Month(s.StartDate);m<=max;m=m.AddMonths(1)) {
                if(m<Month(s.StartDate))continue;
                var day=OccurrenceDate(s.StartDate,m);
                if(s.EndDate is { } finish && day>finish)continue;
                var key=Key(m);
                if(!seenRevenue.Add($"{s.Id}:{key}"))continue;
                var rule=rules.LastOrDefault(x=>x.EffectiveMonth<=m);
                var data=rule is null?new RevenueSnapshot(s.RevenueItemName,s.Amount,s.PaymentMethod,s.ReferenceName,s.Notes):
                    JsonSerializer.Deserialize<RevenueSnapshot>(rule.SnapshotJson)!;
                db.Revenues.Add(new RevenueEntry {UserId=userId,RevenueItemName=data.RevenueItemName,Amount=data.Amount,
                    PaymentMethod=data.PaymentMethod,ReferenceName=data.ReferenceName,Notes=data.Notes,Date=day,
                    RecurringSeriesId=s.Id,RecurringOccurrenceKey=key});
            }
        }
        foreach(var s in expense) {
            var max=s.EndDate is { } end && Month(end)<through?Month(end):through;
            var rules=revisions.Where(x=>x.SeriesId==s.Id&&x.Kind=="expense").ToList();
            for(var m=Month(s.StartDate);m<=max;m=m.AddMonths(1)) {
                var day=OccurrenceDate(s.StartDate,m);
                if(s.EndDate is { } finish && day>finish)continue;
                var key=Key(m);
                if(!seenExpense.Add($"{s.Id}:{key}"))continue;
                var rule=rules.LastOrDefault(x=>x.EffectiveMonth<=m);
                var data=rule is null?new ExpenseSnapshot(s.Description,s.Category,s.ExpenseType,s.Amount,s.PaymentMethod,s.Notes):
                    JsonSerializer.Deserialize<ExpenseSnapshot>(rule.SnapshotJson)!;
                db.Expenses.Add(new ExpenseEntry {UserId=userId,Description=data.Description,Category=data.Category,
                    ExpenseType=data.ExpenseType,Amount=data.Amount,PaymentMethod=data.PaymentMethod,
                    Notes=data.Notes,Date=day,Paid=false,RecurringSeriesId=s.Id,RecurringOccurrenceKey=key});
            }
        }
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
    }

    public async Task EndRevenueAsync(int userId,Guid id) {
        await using var tx=await db.Database.BeginTransactionAsync();
        var s=await db.RevenueSeries.FirstOrDefaultAsync(x=>x.Id==id&&x.UserId==userId&&x.Active);
        if(s is null)throw new InvalidOperationException("Recorrência não encontrada.");
        var now=DateTime.Today;
        var future=await db.Revenues.Where(x=>x.UserId==userId&&x.RecurringSeriesId==id&&x.Date>now).ToListAsync();
        db.Revenues.RemoveRange(future);
        s.Active=false;s.EndDate=now;s.UpdatedAt=DateTime.UtcNow;
        audit.Add("END","Receita recorrente",id,new {futureDeleted=future.Count});
        await db.SaveChangesAsync();await tx.CommitAsync();
    }
    public async Task EndExpenseAsync(int userId,Guid id) {
        await using var tx=await db.Database.BeginTransactionAsync();
        var s=await db.ExpenseSeries.FirstOrDefaultAsync(x=>x.Id==id&&x.UserId==userId&&x.Active);
        if(s is null)throw new InvalidOperationException("Recorrência não encontrada.");
        var now=DateTime.Today;
        var future=await db.Expenses.Where(x=>x.UserId==userId&&x.RecurringSeriesId==id&&x.Date>now).ToListAsync();
        db.Expenses.RemoveRange(future);
        s.Active=false;s.EndDate=now;s.UpdatedAt=DateTime.UtcNow;
        audit.Add("END","Despesa recorrente",id,new {futureDeleted=future.Count});
        await db.SaveChangesAsync();await tx.CommitAsync();
    }
}