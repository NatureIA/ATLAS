using Atlas.Domain;
using Microsoft.EntityFrameworkCore;

namespace Atlas.Data;
public sealed class FinanceDbContext(DbContextOptions<FinanceDbContext> options) : DbContext(options) {
    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<RevenueEntry> Revenues => Set<RevenueEntry>();
    public DbSet<ExpenseEntry> Expenses => Set<ExpenseEntry>();
    public DbSet<RecurringRevenueSeries> RevenueSeries => Set<RecurringRevenueSeries>();
    public DbSet<RecurringExpenseSeries> ExpenseSeries => Set<RecurringExpenseSeries>();
    public DbSet<RevenueItem> RevenueItems => Set<RevenueItem>();
    public DbSet<FinancialGoal> Goals => Set<FinancialGoal>();
    public DbSet<AuditLog> Audits => Set<AuditLog>();
    public DbSet<SeriesRevision> Revisions => Set<SeriesRevision>();

    protected override void OnModelCreating(ModelBuilder b) {
        var u=b.Entity<AppUser>();
        u.ToTable("Usuarios"); u.HasKey(x=>x.Id);
        u.Property(x=>x.Nome).HasMaxLength(120); u.Property(x=>x.Email).HasMaxLength(180);
        u.Property(x=>x.PasswordHash).HasMaxLength(300); u.Property(x=>x.Role).HasMaxLength(20);
        u.HasIndex(x=>x.Email).IsUnique();
        var r=b.Entity<RevenueEntry>(); r.ToTable("AtlasFinRevenueEntries"); r.HasKey(x=>x.Id);
        r.Property(x=>x.RevenueItemName).HasMaxLength(160); r.Property(x=>x.PaymentMethod).HasMaxLength(40);
        r.Property(x=>x.ReferenceName).HasMaxLength(160); r.Property(x=>x.Notes).HasMaxLength(1000);
        r.Property(x=>x.Amount).HasPrecision(18,2); r.Property(x=>x.Date).HasColumnType("date");
        r.Property(x=>x.RecurringOccurrenceKey).HasMaxLength(7);
        r.HasIndex(x=>new{x.UserId,x.Date});
        r.HasIndex(x=>new{x.RecurringSeriesId,x.RecurringOccurrenceKey}).IsUnique().HasFilter("[RecurringSeriesId] IS NOT NULL");
        var e=b.Entity<ExpenseEntry>(); e.ToTable("AtlasFinExpenseEntries"); e.HasKey(x=>x.Id);
        e.Property(x=>x.Description).HasMaxLength(250); e.Property(x=>x.Category).HasMaxLength(100);
        e.Property(x=>x.ExpenseType).HasMaxLength(40); e.Property(x=>x.PaymentMethod).HasMaxLength(40);
        e.Property(x=>x.Notes).HasMaxLength(1000); e.Property(x=>x.Amount).HasPrecision(18,2);
        e.Property(x=>x.Date).HasColumnType("date"); e.Property(x=>x.DueDate).HasColumnType("date");
        e.Property(x=>x.RecurringOccurrenceKey).HasMaxLength(7);
        e.HasIndex(x=>new{x.UserId,x.Date}); e.HasIndex(x=>x.InstallmentGroupId);
        e.HasIndex(x=>new{x.RecurringSeriesId,x.RecurringOccurrenceKey}).IsUnique().HasFilter("[RecurringSeriesId] IS NOT NULL");
        var rs=b.Entity<RecurringRevenueSeries>(); rs.ToTable("AtlasFinRecurringRevenueSeries"); rs.HasKey(x=>x.Id);
        rs.Property(x=>x.RevenueItemName).HasMaxLength(160); rs.Property(x=>x.PaymentMethod).HasMaxLength(40);
        rs.Property(x=>x.ReferenceName).HasMaxLength(160); rs.Property(x=>x.Notes).HasMaxLength(1000);
        rs.Property(x=>x.StartDate).HasColumnType("date"); rs.Property(x=>x.EndDate).HasColumnType("date");
        rs.Property(x=>x.Amount).HasPrecision(18,2); rs.HasIndex(x=>new{x.UserId,x.Active});
        var es=b.Entity<RecurringExpenseSeries>(); es.ToTable("AtlasFinRecurringExpenseSeries"); es.HasKey(x=>x.Id);
        es.Property(x=>x.Description).HasMaxLength(250); es.Property(x=>x.Category).HasMaxLength(100);
        es.Property(x=>x.ExpenseType).HasMaxLength(40); es.Property(x=>x.PaymentMethod).HasMaxLength(40);
        es.Property(x=>x.Notes).HasMaxLength(1000); es.Property(x=>x.Amount).HasPrecision(18,2);
        es.Property(x=>x.StartDate).HasColumnType("date"); es.Property(x=>x.EndDate).HasColumnType("date");
        es.HasIndex(x=>new{x.UserId,x.Active});
        var i=b.Entity<RevenueItem>(); i.ToTable("AtlasFinRevenueItems"); i.HasKey(x=>x.Id);
        i.Property(x=>x.Name).HasMaxLength(160); i.Property(x=>x.Price).HasPrecision(18,2);
        i.HasIndex(x=>new{x.UserId,x.Name}).IsUnique();
        var g=b.Entity<FinancialGoal>(); g.ToTable("AtlasFinGoals"); g.HasKey(x=>x.Id);
        g.Property(x=>x.Name).HasMaxLength(160); g.Property(x=>x.TargetAmount).HasPrecision(18,2);
        g.Property(x=>x.CurrentAmount).HasPrecision(18,2); g.Property(x=>x.Deadline).HasColumnType("date");
        g.HasIndex(x=>new{x.UserId,x.Deadline});
        var a=b.Entity<AuditLog>(); a.ToTable("AtlasFinAuditLog"); a.HasKey(x=>x.Id);
        a.Property(x=>x.Action).HasMaxLength(25); a.Property(x=>x.Entity).HasMaxLength(60);
        a.Property(x=>x.EntityId).HasMaxLength(70); a.HasIndex(x=>new{x.UserId,x.CreatedAt});
        var rev=b.Entity<SeriesRevision>(); rev.ToTable("AtlasFinSeriesRevisions"); rev.HasKey(x=>x.Id);
        rev.Property(x=>x.Kind).HasMaxLength(10); rev.Property(x=>x.EffectiveMonth).HasColumnType("date");
        rev.HasIndex(x=>new{x.UserId,x.SeriesId,x.Kind,x.EffectiveMonth}).IsUnique();
    }
}