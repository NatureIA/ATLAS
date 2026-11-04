using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Atlas.Data;
using Atlas.Domain;
using Microsoft.EntityFrameworkCore;
using WebPush;

namespace Atlas.Services;

public sealed class PushReminderService(
    FinanceDbContext db,
    RecurringService recurring,
    IConfiguration config,
    ILogger<PushReminderService> logger)
{
    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(config["ATLAS_VAPID_PUBLIC_KEY"]) &&
        !string.IsNullOrWhiteSpace(config["ATLAS_VAPID_PRIVATE_KEY"]) &&
        !string.IsNullOrWhiteSpace(config["ATLAS_VAPID_SUBJECT"]) &&
        !string.IsNullOrWhiteSpace(config["ATLAS_PUSH_JOB_KEY"]);

    public string PublicKey => config["ATLAS_VAPID_PUBLIC_KEY"] ?? "";

    public static string HashEndpoint(string endpoint) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(endpoint)));

    public static bool IsValidEndpoint(string endpoint)
    {
        if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) ||
            uri.Scheme != Uri.UriSchemeHttps || uri.UserInfo.Length > 0 ||
            !uri.IsDefaultPort || uri.AbsolutePath.Length < 2) return false;
        var host=uri.IdnHost.ToLowerInvariant();
        return host is "fcm.googleapis.com" or "fcmregistrations.googleapis.com"
            or "updates.push.services.mozilla.com" or "push.services.mozilla.com"
            or "web.push.apple.com" or "wns2-par02p.notify.windows.com"
            || host.EndsWith(".push.apple.com", StringComparison.Ordinal)
            || host.EndsWith(".notify.windows.com", StringComparison.Ordinal);
    }

    public async Task<int> SendDailyAsync(CancellationToken ct)
    {
        if (!IsConfigured) throw new InvalidOperationException("Push não configurado.");
        // Daily cutoff: UTC day, run at 12:00 UTC (09:00 in Brasilia).
        // The Date field is accounting competence, not an actual due date.
        var today=DateTime.UtcNow.Date;
        var devices=await db.PushDevices.AsNoTracking()
            .Where(x=>x.Active && (x.LastNotifiedDay==null || x.LastNotifiedDay<today))
            .OrderBy(x=>x.Id).Take(1000).ToListAsync(ct);
        var users=devices.Select(x=>x.UserId).Distinct().ToList();
        var sent=0;
        var client=new WebPushClient();
        var vapid=new VapidDetails(
            config["ATLAS_VAPID_SUBJECT"]!,
            config["ATLAS_VAPID_PUBLIC_KEY"]!,
            config["ATLAS_VAPID_PRIVATE_KEY"]!);
        foreach(var userId in users)
        {
            ct.ThrowIfCancellationRequested();
            var user=await db.Users.AsNoTracking().FirstOrDefaultAsync(x=>x.Id==userId && x.Ativo,ct);
            if(user==null) continue;
            try {
                await recurring.EnsureThroughAsync(userId,today,ct);
            } catch(Exception e) {
                logger.LogError(e,"ATLAS push: falha na atualização de recorrência para usuário {UserId}",userId);
                continue;
            }
            var count=await db.Expenses.AsNoTracking()
                .CountAsync(x=>x.UserId==userId && !x.Paid && x.Date<=today,ct);
            if(count==0) continue;
            var payload=JsonSerializer.Serialize(new {
                title="ATLAS — Despesas sem baixa",
                body=count==1?"Você possui 1 despesa pendente de baixa.":$"Você possui {count} despesas pendentes de baixa.",
                url="/Expenses?status=pending",
                tag="atlas-pending-expenses"
            });
            foreach(var device in devices.Where(x=>x.UserId==userId))
            {
                ct.ThrowIfCancellationRequested();
                // Atomic daily claim avoids duplicate messages across overlapping scheduled runs.
                var claimed=await db.PushDevices.Where(x=>x.Id==device.Id && x.Active &&
                    (x.LastNotifiedDay==null || x.LastNotifiedDay<today))
                    .ExecuteUpdateAsync(set=>set
                        .SetProperty(x=>x.LastNotifiedDay,(DateTime?)today)
                        .SetProperty(x=>x.LastNotifiedUtc,(DateTime?)null),ct);
                if(claimed==0)continue;
                try {
                    await client.SendNotificationAsync(
                        new PushSubscription(device.Endpoint,device.P256dh,device.Auth),
                        payload,vapid,ct);
                    await db.PushDevices.Where(x=>x.Id==device.Id)
                        .ExecuteUpdateAsync(set=>set
                            .SetProperty(x=>x.LastNotifiedUtc,(DateTime?)DateTime.UtcNow),ct);
                    sent++;
                } catch(WebPushException e) {
                    if((int)e.StatusCode is 404 or 410) {
                        await db.PushDevices.Where(x=>x.Id==device.Id)
                            .ExecuteUpdateAsync(set=>set.SetProperty(x=>x.Active,false),ct);
                    } else {
                        await ReleaseClaim(device.Id,today,ct);
                    }
                    logger.LogWarning("ATLAS push delivery failed (status {Status}) for device {Id}",(int)e.StatusCode,device.Id);
                } catch(Exception e) {
                    await ReleaseClaim(device.Id,today,ct);
                    logger.LogError(e,"ATLAS push delivery failed for device {Id}",device.Id);
                }
            }
        }
        return sent;
    }

    private Task<int> ReleaseClaim(long id,DateTime today,CancellationToken ct) =>
        db.PushDevices.Where(x=>x.Id==id && x.LastNotifiedDay==today && x.LastNotifiedUtc==null)
            .ExecuteUpdateAsync(set=>set.SetProperty(x=>x.LastNotifiedDay,(DateTime?)null),ct);
}
