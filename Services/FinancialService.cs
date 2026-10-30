using Atlas.Data;
using Atlas.Domain;
using Atlas.ViewModels;
using Microsoft.EntityFrameworkCore;
using System.Globalization;

namespace Atlas.Services;
public sealed class FinancialService(FinanceDbContext db,RecurringService recurrence) {
    private static readonly CultureInfo Pt=CultureInfo.GetCultureInfo("pt-BR");
    private static (DateTime start,DateTime end) Range(int year,int month) {
        if(year is < 2000 or > 2100 || month is < 1 or > 12)throw new ArgumentOutOfRangeException(nameof(month));
        var start=new DateTime(year,month,1);return(start,start.AddMonths(1));
    }
    public async Task<DashboardVm> DashboardAsync(int userId,int year,int month) {
        var (start,end)=Range(year,month);
        await recurrence.EnsureThroughAsync(userId,end.AddMonths(-1));
        var since=start.AddMonths(-5);
        var r=await db.Revenues.AsNoTracking().Where(x=>x.UserId==userId&&x.Date>=since&&x.Date<end).ToListAsync();
        var e=await db.Expenses.AsNoTracking().Where(x=>x.UserId==userId&&x.Date>=since&&x.Date<end).ToListAsync();
        var monthRevenue=r.Where(x=>x.Date>=start&&x.Date<end).OrderByDescending(x=>x.Date).ThenByDescending(x=>x.Id).ToList();
        var monthExpenses=e.Where(x=>x.Date>=start&&x.Date<end).ToList();
        var today=DateTime.Today;
        bool includeScheduled=start>=RecurringService.Month(today);
        var basis=includeScheduled?monthExpenses:monthExpenses.Where(x=>x.Paid).ToList();
        var revenue=monthRevenue.Sum(x=>x.Amount);
        var expenses=basis.Sum(x=>x.Amount);
        var targetGoal=await db.Goals.AsNoTracking().Where(x=>x.UserId==userId && (x.Deadline==null || (x.Deadline>=start&&x.Deadline<end)))
            .OrderByDescending(x=>x.Id).FirstOrDefaultAsync();
        var target=targetGoal?.TargetAmount??0m;
        var remaining=Math.Max(0,target-revenue);
        var isCurrent=year==today.Year&&month==today.Month;
        var dailyNeeded=isCurrent&&target>0?remaining/(DateTime.DaysInMonth(year,month)-today.Day+1):0;
        var elapsed=isCurrent?today.Day:DateTime.DaysInMonth(year,month);
        var projected=elapsed>0?revenue/elapsed*DateTime.DaysInMonth(year,month):revenue;
        var margin=revenue==0?0:(revenue-expenses)/revenue*100;
        string insight=target>0&&revenue>=target ? $"Meta atingida: {Fmt(revenue-target)} acima do objetivo." :
            isCurrent&&target>0 ? $"Faltam {Fmt(remaining)} para a meta. Ritmo necessário: {Fmt(dailyNeeded)} por dia." :
            revenue==0?"Ainda não há receitas registradas nesta competência.":
            $"Sua margem operacional é de {margin:N1}% nesta competência.";
        var history=new List<MonthlyPoint>();
        for(var i=0;i<6;i++){
            var d=since.AddMonths(i);var until=d.AddMonths(1);
            var rr=r.Where(x=>x.Date>=d&&x.Date<until).Sum(x=>x.Amount);
            var all=e.Where(x=>x.Date>=d&&x.Date<until);
            var ee=(d>=RecurringService.Month(today)?all:all.Where(x=>x.Paid)).Sum(x=>x.Amount);
            history.Add(new MonthlyPoint(d.Year,d.Month,Pt.DateTimeFormat.GetAbbreviatedMonthName(d.Month).TrimEnd('.'),rr,ee,rr-ee));
        }
        return new DashboardVm {Year=year,Month=month,Revenue=revenue,Expenses=expenses,SalesCount=monthRevenue.Count,
            ProjectedRevenue=projected,Target=target,DailyNeeded=dailyNeeded,Insight=insight,History=history,
            Sources=monthRevenue.GroupBy(x=>x.RevenueItemName).Select(x=>new NamedAmount(x.Key,x.Sum(y=>y.Amount)))
                .OrderByDescending(x=>x.Amount).Take(6).ToList(),
            Categories=basis.GroupBy(x=>x.Category).Select(x=>new NamedAmount(x.Key,x.Sum(y=>y.Amount)))
                .OrderByDescending(x=>x.Amount).Take(7).ToList(),
            Recent=monthRevenue.Take(8).ToList()};
    }
    public async Task<ReportVm> ReportAsync(int userId,int year) {
        if(year is < 2000 or > 2100)throw new ArgumentOutOfRangeException(nameof(year));
        var start=new DateTime(year,1,1);var end=start.AddYears(1);
        await recurrence.EnsureThroughAsync(userId,end.AddDays(-1));
        var revenues=await db.Revenues.AsNoTracking().Where(x=>x.UserId==userId&&x.Date>=start&&x.Date<end).ToListAsync();
        // Annual reports represent all registered commitments, whether paid or pending.
        // Payment status is reported separately; no financial movement is modified.
        var expenses=await db.Expenses.AsNoTracking().Where(x=>x.UserId==userId&&x.Date>=start&&x.Date<end).ToListAsync();
        var months=new List<MonthlyPoint>();
        for(var m=1;m<=12;m++){
            var income=revenues.Where(x=>x.Date.Month==m).Sum(x=>x.Amount);
            var cost=expenses.Where(x=>x.Date.Month==m).Sum(x=>x.Amount);
            months.Add(new MonthlyPoint(year,m,Pt.DateTimeFormat.GetAbbreviatedMonthName(m).TrimEnd('.'),income,cost,income-cost));
        }
        return new ReportVm {Year=year,Revenue=revenues.Sum(x=>x.Amount),Expenses=expenses.Sum(x=>x.Amount),
            PaidExpenses=expenses.Where(x=>x.Paid).Sum(x=>x.Amount),
            PendingExpenses=expenses.Where(x=>!x.Paid).Sum(x=>x.Amount),
            SourceCount=revenues.Select(x=>x.RevenueItemName).Distinct().Count(),Months=months,
            Sources=revenues.GroupBy(x=>x.RevenueItemName).Select(x=>new NamedAmount(x.Key,x.Sum(y=>y.Amount))).OrderByDescending(x=>x.Amount).ToList(),
            Categories=expenses.GroupBy(x=>x.Category).Select(x=>new NamedAmount(x.Key,x.Sum(y=>y.Amount))).OrderByDescending(x=>x.Amount).ToList(),
            Methods=revenues.GroupBy(x=>x.PaymentMethod).Select(x=>new NamedAmount(x.Key,x.Sum(y=>y.Amount))).OrderByDescending(x=>x.Amount).ToList()};
    }
    private static string Fmt(decimal v)=>v.ToString("C",Pt);
}