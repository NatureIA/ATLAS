using System.ComponentModel.DataAnnotations;
using Atlas.Domain;

namespace Atlas.ViewModels;
public class LoginInput {
    [Required,EmailAddress] public string Email {get;set;}="";
    [Required] public string Password {get;set;}="";
    public string? ReturnUrl {get;set;}
}
public class SetupInput : LoginInput {
    [Required,MaxLength(120)] public string Name {get;set;}="";
    [Required] public string SetupKey {get;set;}="";
}
public class RevenueInput {
    public long? Id {get;set;}
    [Required,MaxLength(160)] public string ItemName {get;set;}="";
    [MaxLength(160)] public string? NewItemName {get;set;}
    [Range(typeof(decimal),"0.01","999999999999.99")] public decimal Amount {get;set;}
    [Required] public string PaymentMethod {get;set;}="Pix";
    [MaxLength(160)] public string? ReferenceName {get;set;}
    [MaxLength(1000)] public string? Notes {get;set;}
    public bool IsRecurring {get;set;}
    public List<RevenueItem> Items {get;set;}=[];
    public bool ExistingRecurring {get;set;}
}
public class ExpenseInput {
    public long? Id {get;set;}
    [Required,MaxLength(250)] public string Description {get;set;}="";
    [Required,MaxLength(100)] public string Category {get;set;}="Outros";
    [MaxLength(100)] public string? NewCategory {get;set;}
    [Required] public string ExpenseType {get;set;}="Variável";
    [Range(typeof(decimal),"0.01","999999999999.99")] public decimal Amount {get;set;}
    [Required] public string PaymentMethod {get;set;}="Pix";
    public bool Paid {get;set;}
    public bool IsRecurring {get;set;}
    [Range(1,120)] public int Installments {get;set;}=1;
    [DataType(DataType.Date)] public DateTime? FirstBillDate {get;set;}
    [MaxLength(1000)] public string? Notes {get;set;}
    public List<string> Categories {get;set;}=[];
    public bool ExistingRecurring {get;set;}
}
public class InstallmentGroupInput {
    public Guid GroupId {get;set;}
    [Required,MaxLength(250)] public string Description {get;set;}="";
    [Required,MaxLength(100)] public string Category {get;set;}="Outros";
    [MaxLength(100)] public string? NewCategory {get;set;}
    [Required] public string ExpenseType {get;set;}="Variável";
    [Range(typeof(decimal),"0.01","999999999999.99")] public decimal Amount {get;set;}
    [Required] public string PaymentMethod {get;set;}="Crédito";
    [Range(1,120)] public int Installments {get;set;}=1;
    [Required,DataType(DataType.Date)] public DateTime FirstInstallmentDate {get;set;}
    [MaxLength(1000)] public string? Notes {get;set;}
    public List<string> Categories {get;set;}=[];
    public int CurrentInstallments {get;set;}
    public int PaidCount {get;set;}
    public int LastPaidNumber {get;set;}
    public decimal PaidAmountTotal {get;set;}
}
public class ItemInput {
    public int? Id {get;set;}
    [Required,MaxLength(160)] public string Name {get;set;}="";
    public decimal Price {get;set;}
    public bool Active {get;set;}=true;
}
public class GoalInput {
    [Required,MaxLength(160)] public string Name {get;set;}="";
    [Range(typeof(decimal),"0.01","999999999999.99")] public decimal TargetAmount {get;set;}
    [DataType(DataType.Date)] public DateTime? Deadline {get;set;}
}
public class RevenueListVm {
    public List<RevenueEntry> Rows {get;set;}=[];
    public string? Search {get;set;}
    public string? PaymentMethod {get;set;}
    public int? Year {get;set;}
    public int? Month {get;set;}
}
public class ExpenseListVm {
    public List<ExpenseEntry> Rows {get;set;}=[];
    public string? Search {get;set;}
    public string? Status {get;set;}
    public string? Category {get;set;}
    public string? ExpenseType {get;set;}
    public string? PaymentMethod {get;set;}
    public int? Year {get;set;}
    public int? Month {get;set;}
    public List<string> Categories {get;set;}=[];
    public HashSet<Guid> ActiveSeries {get;set;}=[];
}
public record NamedAmount(string Name,decimal Amount);
public record MonthlyPoint(int Year,int Month,string Label,decimal Income,decimal Expense,decimal Result);
public class DashboardVm {
    public int Year {get;set;}
    public int Month {get;set;}
    public decimal Revenue {get;set;}
    public decimal Expenses {get;set;}
    public decimal Profit => Revenue-Expenses;
    public decimal Margin => Revenue<=0?0:Math.Round(Profit/Revenue*100,1);
    public int SalesCount {get;set;}
    public decimal Ticket => SalesCount==0?0:Revenue/SalesCount;
    public decimal ProjectedRevenue {get;set;}
    public decimal Target {get;set;}
    public decimal Remaining => Math.Max(0,Target-Revenue);
    public decimal DailyNeeded {get;set;}
    public string Insight {get;set;}="";
    public List<NamedAmount> Categories {get;set;}=[];
    public List<NamedAmount> Sources {get;set;}=[];
    public List<MonthlyPoint> History {get;set;}=[];
    public List<RevenueEntry> Recent {get;set;}=[];
}
public class ReportVm {
    public int Year {get;set;}
    public decimal Revenue {get;set;}
    public decimal Expenses {get;set;}
    public decimal Profit => Revenue-Expenses;
    public decimal Margin => Revenue<=0?0:Math.Round(Profit/Revenue*100,1);
    public int SourceCount {get;set;}
    public List<MonthlyPoint> Months {get;set;}=[];
    public List<NamedAmount> Sources {get;set;}=[];
    public List<NamedAmount> Categories {get;set;}=[];
    public List<NamedAmount> Methods {get;set;}=[];
}