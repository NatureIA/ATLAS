using Atlas.Data;
using Atlas.Domain;
using Microsoft.AspNetCore.Identity;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Org.BouncyCastle.Crypto.Generators;

namespace Atlas.Services;
public sealed class CurrentUser(IHttpContextAccessor http) {
    public int Id => int.TryParse(http.HttpContext?.User.FindFirstValue(ClaimTypes.NameIdentifier), out var id)
        ? id : throw new UnauthorizedAccessException("Sessão inválida");
    public string Name => http.HttpContext?.User.Identity?.Name ?? "Usuário";
}
public sealed class PasswordService {
    private readonly PasswordHasher<AppUser> _hasher = new();
    public string Hash(AppUser user, string password) => _hasher.HashPassword(user, password);
    public PasswordVerificationResult Verify(AppUser user, string password) {
        if (user.PasswordHash.Contains(':')) {
            try {
                var parts=user.PasswordHash.Split(':');
                if(parts.Length != 2) return PasswordVerificationResult.Failed;
                var salt=Encoding.UTF8.GetBytes(parts[0]);
                var expected=Convert.FromHexString(parts[1]);
                var actual=SCrypt.Generate(Encoding.UTF8.GetBytes(password),salt,16384,8,1,expected.Length);
                return expected.Length==64 && CryptographicOperations.FixedTimeEquals(actual,expected)
                    ? PasswordVerificationResult.SuccessRehashNeeded : PasswordVerificationResult.Failed;
            } catch { return PasswordVerificationResult.Failed; }
        }
        return _hasher.VerifyHashedPassword(user,user.PasswordHash,password);
    }
}
public sealed class AuditService(FinanceDbContext db,CurrentUser user) {
    public void Add(string action,string entity,object id,object? details=null) {
        db.Audits.Add(new AuditLog { UserId=user.Id, Action=action,Entity=entity,
            EntityId=id.ToString()??"",Details=details is null?null:System.Text.Json.JsonSerializer.Serialize(details),CreatedAt=DateTime.UtcNow });
    }
}