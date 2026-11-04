using System.Security.Cryptography;
using System.Text;
using Atlas.Data;
using Atlas.Domain;
using Atlas.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Atlas.Controllers;

[ApiController]
[Route("api/push")]
public sealed class PushController(FinanceDbContext db,CurrentUser current,
    PushReminderService reminders,IConfiguration config) : ControllerBase
{
    [HttpGet("config"),Authorize]
    public IActionResult Config() => Ok(new {enabled=reminders.IsConfigured,
        publicKey=reminders.IsConfigured?reminders.PublicKey:""});

    [HttpPost("subscribe"),Authorize,ValidateAntiForgeryToken]
    public async Task<IActionResult> Subscribe([FromBody] PushSubscriptionInput input,CancellationToken ct)
    {
        if(!reminders.IsConfigured)return StatusCode(503,new{error="Notificações ainda não configuradas."});
        if(!ModelState.IsValid||!PushReminderService.IsValidEndpoint(input.Endpoint))
            return BadRequest(new {error="Dados de assinatura inválidos."});
        var hash=PushReminderService.HashEndpoint(input.Endpoint);
        var row=await db.PushDevices.FirstOrDefaultAsync(x=>x.EndpointHash==hash,ct);
        if(row==null) {
            db.PushDevices.Add(new PushDeviceSubscription{UserId=current.Id,EndpointHash=hash,
                Endpoint=input.Endpoint,P256dh=input.P256dh,Auth=input.Auth,Active=true});
        } else {
            row.UserId=current.Id;row.Endpoint=input.Endpoint;row.P256dh=input.P256dh;
            row.Auth=input.Auth;row.Active=true;
            row.LastNotifiedDay=null;row.LastNotifiedUtc=null;
        }
        await db.SaveChangesAsync(ct);
        return Ok(new{enabled=true});
    }

    [HttpPost("unsubscribe"),Authorize,ValidateAntiForgeryToken]
    public async Task<IActionResult> Unsubscribe([FromBody] PushRemoveInput input,CancellationToken ct)
    {
        if(!ModelState.IsValid)return BadRequest();
        var hash=PushReminderService.HashEndpoint(input.Endpoint);
        await db.PushDevices.Where(x=>x.EndpointHash==hash && x.UserId==current.Id)
            .ExecuteUpdateAsync(set=>set.SetProperty(x=>x.Active,false),ct);
        return Ok(new{enabled=false});
    }

    // Called only by authenticated GitHub Actions; never exposed to user sessions.
    [HttpPost("dispatch"),AllowAnonymous,IgnoreAntiforgeryToken]
    public async Task<IActionResult> Dispatch(CancellationToken ct)
    {
        var expected=config["ATLAS_PUSH_JOB_KEY"];
        var provided=Request.Headers["X-ATLAS-PUSH-KEY"].ToString();
        if(string.IsNullOrWhiteSpace(expected)||string.IsNullOrEmpty(provided) ||
            provided.Length!=expected.Length ||
            !CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(expected),Encoding.UTF8.GetBytes(provided)))
            return Unauthorized();
        if(!reminders.IsConfigured)return StatusCode(503,new{error="Push credentials missing."});
        var sent=await reminders.SendDailyAsync(ct);
        return Ok(new{sent});
    }
}
