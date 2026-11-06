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

    private static readonly TimeZoneInfo BrasiliaTimeZone =
        TimeZoneInfo.FindSystemTimeZoneById("America/Sao_Paulo");

    public async Task<int> SendDailyAsync(CancellationToken ct)
    {
        if (!IsConfigured) throw new InvalidOperationException("Push não configurado.");

        // Only the four designated hours; limited retries in each hour.
        // An atomic SQL claim prevents duplicate notifications per timeslot.
        var localNow=TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow,BrasiliaTimeZone);
        var slot=localNow.Hour switch { 8=>8, 12=>12, 15=>15, 18=>18, _=>0 };
        if(slot==0)return 0;
        var today=localNow.Date;
        // Competence is a month, not a bill due date. Include ALL of this month
        // plus historical pending expenses, regardless of the day stored in Date.
        var firstDayNextMonth=new DateTime(today.Year,today.Month,1).AddMonths(1);
        var devices=await db.PushDevices.AsNoTracking()
            .Where(x=>x.Active && (x.LastNotifiedDay==null || x.LastNotifiedDay<today ||
                (x.LastNotifiedDay==today && (x.LastNotifiedSlot==null || x.LastNotifiedSlot!=slot))))
            .OrderBy(x=>x.Id).Take(1000).ToListAsync(ct);
        var users=devices.Select(x=>x.UserId).Distinct().ToList();
        logger.LogInformation("ATLAS push dispatch slot {Slot} date {Day}: {Devices} device(s), {Users} user(s) pending evaluation.",
            slot,today,devices.Count,users.Count);
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
                await recurring.EnsureThroughAsync(userId,today.AddDays(7),ct);
            } catch(Exception e) {
                logger.LogError(e,"ATLAS push: falha na atualização de recorrência para usuário {UserId}",userId);
                continue;
            }
            // Recalculate per user at each window. Due dates are independent from
            // accounting competence; undated entries remain a separate category.
            var pending=await db.Expenses.AsNoTracking()
                .Where(x=>x.UserId==userId && !x.Paid &&
                    (x.DueDate!=null || x.Date<firstDayNextMonth))
                .Select(x=>new {x.Date,x.DueDate})
                .ToListAsync(ct);
            var overdue=pending.Count(x=>x.DueDate.HasValue && x.DueDate.Value.Date<today);
            var dueToday=pending.Count(x=>x.DueDate.HasValue && x.DueDate.Value.Date==today);
            var dueTomorrow=pending.Count(x=>x.DueDate.HasValue && x.DueDate.Value.Date==today.AddDays(1));
            var withinThree=pending.Count(x=>x.DueDate.HasValue && x.DueDate.Value.Date>=today.AddDays(2) && x.DueDate.Value.Date<=today.AddDays(3));
            var withinSeven=pending.Count(x=>x.DueDate.HasValue && x.DueDate.Value.Date>=today.AddDays(4) && x.DueDate.Value.Date<=today.AddDays(7));
            var undated=pending.Count(x=>!x.DueDate.HasValue && x.Date<firstDayNextMonth);

            // The four windows are opportunities, not mandatory messages:
            // 08h: overall summary, including undated competence commitments.
            // 12h and 15h: only overdue or due today.
            // 18h: overdue, due today, or due tomorrow.
            var parts=new List<string>();
            if(overdue>0)parts.Add($"{overdue} vencida(s)");
            if(dueToday>0)parts.Add($"{dueToday} vence(m) hoje");
            if(slot is 8 or 18 && dueTomorrow>0)parts.Add($"{dueTomorrow} vence(m) amanhã");
            if(slot==8) {
                if(withinThree>0)parts.Add($"{withinThree} vence(m) em 2–3 dias");
                if(withinSeven>0)parts.Add($"{withinSeven} vence(m) em 4–7 dias");
                if(undated>0)parts.Add($"{undated} sem vencimento informado");
            }
            // Receipts share the same dispatch and per-device timeslot claim with expenses.
            // Only forecast dates matter; confirmed receipt is never counted.
            var revenuePending=await db.Revenues.AsNoTracking()
                .Where(x=>x.UserId==userId && !x.Received && x.ExpectedReceiptDate!=null)
                .Select(x=>x.ExpectedReceiptDate)
                .ToListAsync(ct);
            var revenueLate=revenuePending.Count(x=>x!.Value.Date<today);
            var revenueToday=revenuePending.Count(x=>x!.Value.Date==today);
            var revenueTomorrow=revenuePending.Count(x=>x!.Value.Date==today.AddDays(1));
            var revenueWeek=revenuePending.Count(x=>x!.Value.Date>today.AddDays(1) && x!.Value.Date<=today.AddDays(7));
            if(revenueLate>0 && slot is 8 or 15)parts.Add($"{revenueLate} recebimento(s) atrasado(s)");
            if(revenueToday>0 && slot is 8 or 12 or 18)parts.Add($"{revenueToday} recebimento(s) previsto(s) hoje");
            if(revenueTomorrow>0 && slot is 8 or 18)parts.Add($"{revenueTomorrow} previsto(s) amanhã");
            if(revenueWeek>0 && slot==8)parts.Add($"{revenueWeek} recebimento(s) nos próximos 7 dias");
            if(parts.Count==0)continue;
            var payload=JsonSerializer.Serialize(new {
                title=overdue>0 || dueToday>0 || revenueLate>0?"ATLAS — Seu financeiro precisa de atenção":"ATLAS — Próximos compromissos",
                body=string.Join("; ",parts)+". Consulte suas despesas.",
                url="/Home",
                tag="atlas-pending-expenses"
            });
            foreach(var device in devices.Where(x=>x.UserId==userId))
            {
                ct.ThrowIfCancellationRequested();
                // Atomic per-slot claim avoids duplicate messages if the ten-minute
                // worker runs repeatedly or overlapping executions occur.
                var claimed=await db.PushDevices.Where(x=>x.Id==device.Id && x.Active &&
                    (x.LastNotifiedDay==null || x.LastNotifiedDay<today ||
                     (x.LastNotifiedDay==today && (x.LastNotifiedSlot==null || x.LastNotifiedSlot!=slot))))
                    .ExecuteUpdateAsync(set=>set
                        .SetProperty(x=>x.LastNotifiedDay,(DateTime?)today)
                        .SetProperty(x=>x.LastNotifiedSlot,(int?)slot)
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
                        await ReleaseClaim(device.Id,today,slot,ct);
                    }
                    logger.LogWarning("ATLAS push delivery failed (status {Status}) for device {Id}",(int)e.StatusCode,device.Id);
                } catch(Exception e) {
                    await ReleaseClaim(device.Id,today,slot,ct);
                    logger.LogError(e,"ATLAS push delivery failed for device {Id}",device.Id);
                }
            }
        }
        logger.LogInformation("ATLAS push slot {Slot} date {Day}: {Sent} notification(s) accepted by push providers.",
            slot,today,sent);
        return sent;
    }

    // Explicit user-initiated test; it does not consume any scheduled reminder slot.
    public async Task<string> TestDeviceAsync(int userId,string endpoint,CancellationToken ct) {
        if(!IsConfigured)return "Notificações não configuradas no servidor.";
        var hash=HashEndpoint(endpoint);
        var device=await db.PushDevices.AsNoTracking()
            .FirstOrDefaultAsync(x=>x.UserId==userId && x.EndpointHash==hash && x.Active,ct);
        if(device==null)return "Este dispositivo não está registrado para notificações.";
        try {
            var vapid=new VapidDetails(config["ATLAS_VAPID_SUBJECT"]!,
                config["ATLAS_VAPID_PUBLIC_KEY"]!,config["ATLAS_VAPID_PRIVATE_KEY"]!);
            await new WebPushClient().SendNotificationAsync(
                new PushSubscription(device.Endpoint,device.P256dh,device.Auth),
                JsonSerializer.Serialize(new {title="ATLAS — Teste de notificação",
                    body="Esta notificação confirma que o dispositivo recebeu o teste.",
                    url="/Home",tag="atlas-push-test"}),vapid,ct);
            logger.LogInformation("ATLAS push manual test accepted for user {UserId}, device {DeviceId}",userId,device.Id);
            return "Envio aceito pelo provedor. Confira a notificação neste dispositivo.";
        } catch(WebPushException ex) {
            if((int)ex.StatusCode is 404 or 410)
                await db.PushDevices.Where(x=>x.Id==device.Id)
                    .ExecuteUpdateAsync(set=>set.SetProperty(x=>x.Active,false),ct);
            logger.LogWarning(ex,"ATLAS push manual test rejected for device {DeviceId}",device.Id);
            return $"Provedor recusou a notificação (HTTP {(int)ex.StatusCode}).";
        } catch(Exception ex) {
            logger.LogError(ex,"ATLAS push manual test failed for device {DeviceId}",device.Id);
            return "Falha no envio; consulte os logs da hospedagem.";
        }
    }

    private Task<int> ReleaseClaim(long id,DateTime today,int slot,CancellationToken ct) =>
        db.PushDevices.Where(x=>x.Id==id && x.LastNotifiedDay==today &&
            x.LastNotifiedSlot==slot && x.LastNotifiedUtc==null)
            .ExecuteUpdateAsync(set=>set
                .SetProperty(x=>x.LastNotifiedDay,(DateTime?)null)
                .SetProperty(x=>x.LastNotifiedSlot,(int?)null),ct);
}
