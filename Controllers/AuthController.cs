using Atlas.Data;
using Atlas.Domain;
using Atlas.Services;
using Atlas.ViewModels;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using System.Data;

namespace Atlas.Controllers;
[AllowAnonymous]
public class AuthController(FinanceDbContext db,PasswordService passwords,IConfiguration config) : Controller {
    [HttpGet] public IActionResult Login(string? returnUrl=null) {
        if(User.Identity?.IsAuthenticated==true)return RedirectToAction("Index","Home");
        return View(new LoginInput {ReturnUrl=returnUrl});
    }
    [HttpPost,ValidateAntiForgeryToken]
    public async Task<IActionResult> Login(LoginInput input) {
        if(!ModelState.IsValid)return View(input);
        var email=input.Email.Trim().ToLowerInvariant();
        var user=await db.Users.FirstOrDefaultAsync(x=>x.Email==email&&x.Ativo);
        if(user is null||passwords.Verify(user,input.Password)==PasswordVerificationResult.Failed){
            ModelState.AddModelError("","Credenciais inválidas.");return View(input);
        }
        if(user.PasswordHash.Contains(':')) {user.PasswordHash=passwords.Hash(user,input.Password);await db.SaveChangesAsync();}
        await SignIn(user);
        if(!string.IsNullOrWhiteSpace(input.ReturnUrl)&&Url.IsLocalUrl(input.ReturnUrl))return LocalRedirect(input.ReturnUrl);
        return RedirectToAction("Index","Home");
    }
    [HttpGet] public async Task<IActionResult> Setup(){
        if(await db.Users.AnyAsync())return RedirectToAction("Login");
        if(string.IsNullOrWhiteSpace(config["ATLAS_SETUP_KEY"]))return View("SetupUnavailable");
        return View(new SetupInput());
    }
    [HttpPost,ValidateAntiForgeryToken]
    public async Task<IActionResult> Setup(SetupInput input){
        if(input.Password.Length<12)ModelState.AddModelError(nameof(input.Password),"Senha deve ter ao menos 12 caracteres.");
        if(!ModelState.IsValid)return View(input);
        var key=config["ATLAS_SETUP_KEY"]??"";
        if(string.IsNullOrEmpty(key)||!System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
            System.Text.Encoding.UTF8.GetBytes(input.SetupKey),System.Text.Encoding.UTF8.GetBytes(key))) {
            ModelState.AddModelError("","Chave de instalação inválida.");return View(input);
        }
        await using var tx=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
        if(await db.Users.AnyAsync())return RedirectToAction("Login");
        var user=new AppUser{Name=input.Name.Trim(),Email=input.Email.Trim().ToLowerInvariant(),Role="ADMIN",Ativo=true};
        user.PasswordHash=passwords.Hash(user,input.Password);
        db.Users.Add(user);await db.SaveChangesAsync();await tx.CommitAsync();
        await SignIn(user);
        return RedirectToAction("Index","Home");
    }
    [Authorize,HttpPost,ValidateAntiForgeryToken]
    public async Task<IActionResult> Logout(){
        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return RedirectToAction("Login");
    }
    private Task SignIn(AppUser user){
        var claims=new[] {new Claim(ClaimTypes.NameIdentifier,user.Id.ToString()),new Claim(ClaimTypes.Name,user.Nome),
            new Claim(ClaimTypes.Email,user.Email),new Claim(ClaimTypes.Role,user.Role)};
        var identity=new ClaimsIdentity(claims,CookieAuthenticationDefaults.AuthenticationScheme);
        return HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme,
            new ClaimsPrincipal(identity),new AuthenticationProperties{IsPersistent=true,AllowRefresh=true});
    }
}