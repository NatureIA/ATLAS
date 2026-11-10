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
            // Re-opening the app must not reset the daily send limit.
            if(row.UserId!=current.Id || !row.Active) {
                row.LastNotifiedDay=null;row.LastNotifiedUtc=null;
            }
            row.UserId=current.Id;row.Endpoint=input.Endpoint;row.P256dh=input.P256dh;
            row.Auth=input.Auth;row.Active=true;
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

    [HttpGet("status"),Authorize]
    public async Task<IActionResult> Status(CancellationToken ct)
    {
        var devices=await db.PushDevices.AsNoTracking()
            .Where(x=>x.UserId==current.Id && x.Active)
            .Select(x=>new{x.LastNotifiedUtc,x.LastDisplayedUtc}).ToListAsync(ct);
        var today=TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow,
            TimeZoneInfo.FindSystemTimeZoneById("America/Sao_Paulo")).Date;
        var overdue=await db.Expenses.AsNoTracking()
            .CountAsync(x=>x.UserId==current.Id && !x.Paid && x.DueDate!=null && x.DueDate<today,ct);
        return Ok(new {configured=reminders.IsConfigured,activeDevices=devices.Count,overdue,
            lastAcceptedUtc=devices.Where(x=>x.LastNotifiedUtc.HasValue)
                .Select(x=>x.LastNotifiedUtc).OrderByDescending(x=>x).FirstOrDefault(),
            lastDisplayedUtc=devices.Where(x=>x.LastDisplayedUtc.HasValue)
                .Select(x=>x.LastDisplayedUtc).OrderByDescending(x=>x).FirstOrDefault()});
    }

    [HttpPost("test"),Authorize,ValidateAntiForgeryToken]
    public async Task<IActionResult> Test([FromBody] PushRemoveInput input,CancellationToken ct)
    {
        if(!ModelState.IsValid || !PushReminderService.IsValidEndpoint(input.Endpoint))return BadRequest();
        var message=await reminders.TestDeviceAsync(current.Id,input.Endpoint,ct);
        return Ok(new {message});
    }

    // The service worker can acknowledge notification display even with the ATLAS tab closed.
    // No session cookie required: signed receipt, device/day/slot scoped.
    [HttpPost("receipt"),AllowAnonymous,IgnoreAntiforgeryToken]
    public async Task<IActionResult> Receipt([FromBody] PushReceiptInput input,CancellationToken ct)
        => await reminders.ConfirmDisplayAsync(input,ct) ? Ok(new {received=true}) : BadRequest();

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
