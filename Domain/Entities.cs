namespace Atlas.Domain;

public class AppUser {
    public int Id { get; set; }
    public string Nome { get; set; } = "";
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public string Role { get; set; } = "USER";
    public bool Ativo { get; set; } = true;
    public DateTime CriadoEm { get; set; } = DateTime.UtcNow;
}
public class RevenueEntry {
    public long Id { get; set; }
    public int UserId { get; set; }
    public string RevenueItemName { get; set; } = "";
    public decimal Amount { get; set; }
    public string PaymentMethod { get; set; } = "Pix";
    public DateTime Date { get; set; }
    public string? ReferenceName { get; set; }
    public string? Notes { get; set; }
    public Guid? RecurringSeriesId { get; set; }
    public string? RecurringOccurrenceKey { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
public class RecurringRevenueSeries {
    public Guid Id { get; set; } = Guid.NewGuid();
    public int UserId { get; set; }
    public string RevenueItemName { get; set; } = "";
    public decimal Amount { get; set; }
    public string PaymentMethod { get; set; } = "Pix";
    public string? ReferenceName { get; set; }
    public string? Notes { get; set; }
    public DateTime StartDate { get; set; }
    public DateTime? EndDate { get; set; }
    public bool Active { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
public class ExpenseEntry {
    public long Id { get; set; }
    public int UserId { get; set; }
    public string Description { get; set; } = "";
    public string Category { get; set; } = "Outros";
    public string ExpenseType { get; set; } = "Variável";
    public decimal Amount { get; set; }
    public string PaymentMethod { get; set; } = "Pix";
    public DateTime Date { get; set; }
    public DateTime? DueDate { get; set; }
    public bool Paid { get; set; }
    public Guid? InstallmentGroupId { get; set; }
    public int? InstallmentNumber { get; set; }
    public int? InstallmentTotal { get; set; }
    public Guid? RecurringSeriesId { get; set; }
    public string? RecurringOccurrenceKey { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
public class RecurringExpenseSeries {
    public Guid Id { get; set; } = Guid.NewGuid();
    public int UserId { get; set; }
    public string Description { get; set; } = "";
    public string Category { get; set; } = "Outros";
    public string ExpenseType { get; set; } = "Variável";
    public decimal Amount { get; set; }
    public string PaymentMethod { get; set; } = "Pix";
    public DateTime StartDate { get; set; }
    public DateTime? EndDate { get; set; }
    public bool Active { get; set; } = true;
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
public class RevenueItem {
    public int Id { get; set; }
    public int UserId { get; set; }
    public string Name { get; set; } = "";
    public decimal Price { get; set; }
    public bool Active { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
public class FinancialGoal {
    public int Id { get; set; }
    public int UserId { get; set; }
    public string Name { get; set; } = "";
    public decimal TargetAmount { get; set; }
    public decimal CurrentAmount { get; set; }
    public DateTime? Deadline { get; set; }
}
public class AuditLog {
    public long Id { get; set; }
    public int UserId { get; set; }
    public string Action { get; set; } = "";
    public string Entity { get; set; } = "";
    public string EntityId { get; set; } = "";
    public string? Details { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
// Histórico da configuração recorrente. Permite materializar meses anteriores
// a uma alteração sem reescrever as regras que vigoravam na época.
public class SeriesRevision {
    public long Id { get; set; }
    public int UserId { get; set; }
    public Guid SeriesId { get; set; }
    public string Kind { get; set; } = "";
    public DateTime EffectiveMonth { get; set; }
    public string SnapshotJson { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}