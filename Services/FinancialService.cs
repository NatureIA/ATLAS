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
        if(year is < 2000 or > 2100 || month is < 0 or > 12)throw new ArgumentOutOfRangeException(nameof(month));
        var fullYear=month==0;
        var start=new DateTime(year,fullYear?1:month,1);
        var end=fullYear?start.AddYears(1):start.AddMonths(1);
        var today=TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow,
            TimeZoneInfo.FindSystemTimeZoneById("America/Sao_Paulo")).Date;
        var monthStart=new DateTime(today.Year,today.Month,1);
        var forecastEnd=monthStart.AddMonths(12);
        var horizon=today.AddDays(90);
        // Recurring entries are generated only through the required horizon.
        // Previously recorded financial rows and historical statuses are not rewritten.
        await recurrence.EnsureThroughAsync(userId,end.AddDays(-1)>forecastEnd.AddDays(-1)?end.AddDays(-1):forecastEnd.AddDays(-1));
        var chartStart=fullYear?start:start.AddMonths(-5);
        var revenues=await db.Revenues.AsNoTracking()
            .Where(x=>x.UserId==userId && x.Date>=chartStart && x.Date<end).ToListAsync();
        var expenses=await db.Expenses.AsNoTracking()
            .Where(x=>x.UserId==userId && x.Date>=chartStart && x.Date<end).ToListAsync();
        var periodRevenue=revenues.Where(x=>x.Date>=start).ToList();
        var periodExpenses=expenses.Where(x=>x.Date>=start).ToList();
        var revenue=periodRevenue.Sum(x=>x.Amount);
        // Accounting result consistently includes paid and unpaid commitments in every month.
        var expenseTotal=periodExpenses.Sum(x=>x.Amount);
        var received=periodRevenue.Where(x=>x.Received).Sum(x=>x.Amount);
        var expensePaid=periodExpenses.Where(x=>x.Paid).Sum(x=>x.Amount);

        // Attention is based on actual due/expected dates, independent of the selected competence.
        var outstandingExpenses=await db.Expenses.AsNoTracking()
            .Where(x=>x.UserId==userId && !x.Paid && x.DueDate!=null)
            .Select(x=>new {x.Id,x.Description,x.Amount,x.DueDate}).ToListAsync();
        var outstandingRevenues=await db.Revenues.AsNoTracking()
            .Where(x=>x.UserId==userId && !x.Received && x.ExpectedReceiptDate!=null)
            .Select(x=>new {x.Id,x.RevenueItemName,x.Amount,x.ExpectedReceiptDate}).ToListAsync();
        var lateExpenses=outstandingExpenses.Where(x=>x.DueDate!.Value.Date<today).ToList();
        var lateReceipts=outstandingRevenues.Where(x=>x.ExpectedReceiptDate!.Value.Date<today).ToList();
        var dueExpenses=outstandingExpenses.Where(x=>x.DueDate!.Value.Date>=today && x.DueDate.Value.Date<=today.AddDays(7)).ToList();
        var dueReceipts=outstandingRevenues.Where(x=>x.ExpectedReceiptDate!.Value.Date>=today && x.ExpectedReceiptDate.Value.Date<=today.AddDays(7)).ToList();
        var alerts=new List<FinancialAlertVm> {
            new("expense-late","Despesas vencidas",lateExpenses.Count,lateExpenses.Sum(x=>x.Amount),"/Expenses?dueGroup=overdue"),
            new("revenue-late","Recebimentos atrasados",lateReceipts.Count,lateReceipts.Sum(x=>x.Amount),"/Revenue?group=overdue"),
            new("expense-next","Despesas nos próximos 7 dias",dueExpenses.Count,dueExpenses.Sum(x=>x.Amount),"/Expenses"),
            new("revenue-next","A receber nos próximos 7 dias",dueReceipts.Count,dueReceipts.Sum(x=>x.Amount),"/Revenue?group=next7")
        };
        // A dated cashflow is a cumulative delta, not an account balance.
        var incomingByDay=outstandingRevenues
            .Where(x=>x.ExpectedReceiptDate!.Value.Date>=today && x.ExpectedReceiptDate.Value.Date<=horizon)
            .GroupBy(x=>x.ExpectedReceiptDate!.Value.Date)
            .ToDictionary(g=>g.Key,g=>g.Sum(x=>x.Amount));
        var outgoingByDay=outstandingExpenses
            .Where(x=>x.DueDate!.Value.Date>=today && x.DueDate.Value.Date<=horizon)
            .GroupBy(x=>x.DueDate!.Value.Date)
            .ToDictionary(g=>g.Key,g=>g.Sum(x=>x.Amount));
        var cashflow=new List<CashflowDayVm>();
        var cumulative=0m;
        for(var day=0;day<=90;day++) {
            var date=today.AddDays(day);
            incomingByDay.TryGetValue(date,out var incoming);
            outgoingByDay.TryGetValue(date,out var outgoing);
            cumulative+=incoming-outgoing;
            cashflow.Add(new CashflowDayVm(day,incoming,outgoing,cumulative));
        }
        // Forecast the next 12 calendar months using the actual expected receipt
        // and due dates. The current month starts today; overdue commitments are
        // already covered in Attention and must not masquerade as future cash.
        var monthlyForecast=new List<MonthlyForecastVm>();
        for(var index=0;index<12;index++) {
            var periodStart=monthStart.AddMonths(index);
            var periodEnd=periodStart.AddMonths(1);
            var effectiveStart=index==0?today:periodStart;
            var incomingRows=outstandingRevenues
                .Where(x=>x.ExpectedReceiptDate!.Value.Date>=effectiveStart && x.ExpectedReceiptDate.Value.Date<periodEnd)
                .ToList();
            var outgoingRows=outstandingExpenses
                .Where(x=>x.DueDate!.Value.Date>=effectiveStart && x.DueDate.Value.Date<periodEnd)
                .ToList();
            var detail=incomingRows.Select(x=>new ForecastEntryVm(x.Id,true,x.RevenueItemName,
                    x.ExpectedReceiptDate!.Value.Date,x.Amount))
                .Concat(outgoingRows.Select(x=>new ForecastEntryVm(x.Id,false,x.Description,
                    x.DueDate!.Value.Date,x.Amount)))
                .OrderBy(x=>x.ExpectedDate).ThenBy(x=>x.Id).ToList();
            monthlyForecast.Add(new MonthlyForecastVm(index,periodStart.Year,periodStart.Month,
                periodStart.ToString("MMM/yy",Pt),incomingRows.Sum(x=>x.Amount),
                outgoingRows.Sum(x=>x.Amount),detail));
        }
        var history=new List<MonthlyPoint>();
        for(var d=chartStart;d<end;d=d.AddMonths(1)) {
            var upper=d.AddMonths(1);
            var rr=revenues.Where(x=>x.Date>=d && x.Date<upper).ToList();
            var ee=expenses.Where(x=>x.Date>=d && x.Date<upper).Sum(x=>x.Amount);
            var total=rr.Sum(x=>x.Amount);
            history.Add(new MonthlyPoint(d.Year,d.Month,
                Pt.DateTimeFormat.GetAbbreviatedMonthName(d.Month).TrimEnd('.'),
                total,ee,total-ee,rr.Where(x=>x.Received).Sum(x=>x.Amount)));
        }
        var activity=periodRevenue.Select(x=>new FinanceActivityVm(x.Id,true,x.RevenueItemName,x.Date,x.Amount,x.Received?"Recebido":"A receber"))
            .Concat(periodExpenses.Select(x=>new FinanceActivityVm(x.Id,false,x.Description,x.Date,x.Amount,x.Paid?"Pago":"Pendente")))
            .OrderByDescending(x=>x.Date).ThenByDescending(x=>x.Id).Take(8).ToList();
        var currentPeriod=!fullYear && year==today.Year && month==today.Month;
        var targetGoal=fullYear?null:await db.Goals.AsNoTracking()
            .Where(x=>x.UserId==userId && (x.Deadline==null || (x.Deadline>=start && x.Deadline<end)))
            .OrderByDescending(x=>x.Id).FirstOrDefaultAsync();
        var target=targetGoal?.TargetAmount??0m;
        var remaining=Math.Max(0,target-revenue);
        var daysLeft=currentPeriod?DateTime.DaysInMonth(year,month)-today.Day+1:1;
        var dailyNeeded=currentPeriod&&target>0?remaining/daysLeft:0m;
        var elapsed=currentPeriod?today.Day:(fullYear?365:DateTime.DaysInMonth(year,month));
        var projected=currentPeriod&&elapsed>0?revenue/elapsed*DateTime.DaysInMonth(year,month):revenue;
        string insight=lateExpenses.Count>0||lateReceipts.Count>0
            ?$"Atenção: {lateExpenses.Count} despesa(s) vencida(s) ({Fmt(lateExpenses.Sum(x=>x.Amount))}) e {lateReceipts.Count} recebimento(s) atrasado(s) ({Fmt(lateReceipts.Sum(x=>x.Amount))})."
            :dueExpenses.Count>0||dueReceipts.Count>0
                ?$"Nos próximos 7 dias, há {Fmt(dueReceipts.Sum(x=>x.Amount))} a receber e {Fmt(dueExpenses.Sum(x=>x.Amount))} a pagar."
                :target>0&&revenue>=target?$"Meta atingida: {Fmt(revenue-target)} acima do objetivo."
                :currentPeriod&&target>0?$"Faltam {Fmt(remaining)} para a meta mensal."
                :$"Sem vencimentos ou recebimentos previstos para os próximos 7 dias. Resultado da competência: {Fmt(revenue-expenseTotal)}.";
        return new DashboardVm {
            Year=year,Month=month,FullYear=fullYear,Today=today,
            PeriodLabel=fullYear?$"Ano de {year}":start.ToString("MMMM yyyy",Pt),
            Revenue=revenue,Expenses=expenseTotal,SalesCount=periodRevenue.Count,
            ReceivedRevenue=received,ReceivedInPeriod=received,
            PendingRevenue=periodRevenue.Where(x=>!x.Received).Sum(x=>x.Amount),
            ExpensesPaidInPeriod=expensePaid,
            ExpectedReceipts30Days=cashflow.Take(31).Sum(x=>x.Incoming),
            DueExpenses30Days=cashflow.Take(31).Sum(x=>x.Outgoing),
            OverdueReceipts=lateReceipts.Sum(x=>x.Amount),
            OverdueReceiptsCount=lateReceipts.Count,
            Alerts=alerts,CashflowDays=cashflow,MonthlyForecast=monthlyForecast,Activity=activity,
            Target=target,DailyNeeded=dailyNeeded,ProjectedRevenue=projected,Insight=insight,History=history,
            Sources=periodRevenue.GroupBy(x=>x.RevenueItemName)
                .Select(g=>new NamedAmount(g.Key,g.Sum(x=>x.Amount))).OrderByDescending(x=>x.Amount).Take(6).ToList(),
            Categories=periodExpenses.GroupBy(x=>x.Category)
                .Select(g=>new NamedAmount(g.Key,g.Sum(x=>x.Amount))).OrderByDescending(x=>x.Amount).Take(7).ToList(),
            Recent=periodRevenue.OrderByDescending(x=>x.Date).Take(8).ToList()
        };
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
            ReceivedRevenue=revenues.Where(x=>x.Received).Sum(x=>x.Amount),
            PendingRevenue=revenues.Where(x=>!x.Received).Sum(x=>x.Amount),
            PaidExpenses=expenses.Where(x=>x.Paid).Sum(x=>x.Amount),
            PendingExpenses=expenses.Where(x=>!x.Paid).Sum(x=>x.Amount),
            SourceCount=revenues.Select(x=>x.RevenueItemName).Distinct().Count(),Months=months,
            Sources=revenues.GroupBy(x=>x.RevenueItemName).Select(x=>new NamedAmount(x.Key,x.Sum(y=>y.Amount))).OrderByDescending(x=>x.Amount).ToList(),
            Categories=expenses.GroupBy(x=>x.Category).Select(x=>new NamedAmount(x.Key,x.Sum(y=>y.Amount))).OrderByDescending(x=>x.Amount).ToList(),
            Methods=revenues.GroupBy(x=>x.PaymentMethod).Select(x=>new NamedAmount(x.Key,x.Sum(y=>y.Amount))).OrderByDescending(x=>x.Amount).ToList()};
    }
    private static string Fmt(decimal v)=>v.ToString("C",Pt);
}