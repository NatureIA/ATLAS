using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text.RegularExpressions;
using HtmlAgilityPack;

namespace Atlas.Services;

// Public NFC-e document consultation from the QR URL. Does not bypass CAPTCHA,
// use third-party proxies, store documents or infer missing financial information.
public static class FiscalPortalService {
    public sealed record Result(string? Merchant,decimal? Amount,DateTime? PurchaseDate,
        string? PaymentMethod,IReadOnlyList<string> Products,string? Category,bool Paid,
        bool Retrieved,string Message);

    private static readonly HttpClient Client=BuildClient();
    private static HttpClient BuildClient(){
        var handler=new HttpClientHandler {
            AllowAutoRedirect=false,
            UseCookies=false,
            AutomaticDecompression=DecompressionMethods.GZip|DecompressionMethods.Deflate
        };
        var client=new HttpClient(handler){Timeout=TimeSpan.FromSeconds(9)};
        client.DefaultRequestHeaders.UserAgent.ParseAdd("ATLAS/1.0 (consulta publica de NFC-e)");
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("text/html"));
        client.DefaultRequestHeaders.AcceptLanguage.ParseAdd("pt-BR,pt;q=0.9");
        return client;
    }

    public static async Task<Result> ConsultAsync(string? url,string key,CancellationToken cancellationToken){
        Result Fail(string why)=>new(null,null,null,null,[],null,false,false,why);
        if(string.IsNullOrWhiteSpace(url))
            return Fail("A chave fiscal foi identificada, mas o QR Code não trouxe endereço de consulta. Use o QR Code original do cupom.");
        if(!Uri.TryCreate(url,UriKind.Absolute,out var uri)||!IsOfficialConsultation(uri))
            return Fail("O endereço do QR Code não é um portal fiscal oficial reconhecido.");
        try {
            using var response=await Client.GetAsync(uri,HttpCompletionOption.ResponseHeadersRead,cancellationToken);
            if(response.StatusCode is HttpStatusCode.Moved or HttpStatusCode.Redirect or HttpStatusCode.RedirectMethod or HttpStatusCode.TemporaryRedirect or HttpStatusCode.PermanentRedirect)
                return Fail("O portal fiscal redirecionou a consulta. É necessário verificar este portal antes de automatizar o acesso.");
            if(!response.IsSuccessStatusCode)
                return Fail("O portal fiscal não permitiu a consulta automática ("+(int)response.StatusCode+").");
            var type=response.Content.Headers.ContentType?.MediaType??"";
            if(type!="text/html"&&type!="application/xhtml+xml")
                return Fail("O portal fiscal retornou um formato não suportado para consulta automática.");
            if(response.Content.Headers.ContentLength is >1500000)
                return Fail("A resposta do portal ultrapassou o limite seguro.");
            var data=await response.Content.ReadAsByteArrayAsync(cancellationToken);
            if(data.Length>1500000)return Fail("A resposta do portal ultrapassou o limite seguro.");
            var document=new HtmlDocument();
            using(var reader=new StreamReader(new MemoryStream(data),response.Content.Headers.ContentType?.CharSet is string encodingName
                ?TryEncoding(encodingName):System.Text.Encoding.UTF8)){
                document.Load(reader);
            }
            var hiddenNodes=document.DocumentNode.SelectNodes("//script|//style|//noscript|//svg|//iframe");
            if(hiddenNodes!=null)foreach(var remove in hiddenNodes)remove.Remove();
            var plain=Clean(document.DocumentNode.InnerText);
            if(Regex.IsMatch(plain,@"captcha|recaptcha|não sou um robô|verificação humana|captcha de segurança",RegexOptions.IgnoreCase))
                return Fail("A SEFAZ solicitou verificação humana. Não é possível extrair os dados automaticamente neste portal.");
            var compact=Regex.Replace(plain,@"[\s\.\-]","");
            if(!compact.Contains(key,StringComparison.Ordinal))
                return Fail("A resposta fiscal não permitiu confirmar a chave da nota. Nenhum campo financeiro foi importado.");

            var issuer=FromCss(document, new[]{"txtTopo","razaoSocial","nomeFantasia","nomeEmitente","emitenteNome"});
            issuer=ValidIssuer(issuer)?issuer:null;
            issuer??=Capture(plain,@"(?:Razão Social|Nome Fantasia|Nome do Estabelecimento|Emitente)\s*[:\-]\s*([^\r\n]{5,100})",false);
            if(!ValidIssuer(issuer))issuer=null;
            var total=AmountByCss(document, new[]{"totalNumb","valorTotal","totalNota","valor-pagar"});
            total??=AmountByLabel(plain,@"(?:Valor Total da Nota|Valor Total da NFC.e|Valor Total da NF.e|Total da Nota|Valor a Pagar)");
            var dateText=Capture(plain,@"(?:Data\s*(?:e Hora)?\s*de\s*Emiss[aã]o|Emiss[aã]o|Data da Compra)\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})",false);
            DateTime? date=null;
            if(DateTime.TryParseExact(dateText,"dd/MM/yyyy",CultureInfo.GetCultureInfo("pt-BR"),
                DateTimeStyles.None,out var parsed) && parsed.Year is >=2000 and <=2100)
                date=parsed;
            var products=new List<string>();
            var rows=document.DocumentNode.SelectNodes("//table[@id='tabResult']//tr|//table[contains(@class,'produtos')]//tr|//table[contains(@class,'table-produtos')]//tr");
            if(rows!=null){
                foreach(var row in rows){
                    var product=row.SelectSingleNode(".//*[contains(concat(' ',normalize-space(@class),' '),' txtTit ')]")
                        ?? row.SelectSingleNode("./td[1]");
                    var value=Clean(product?.InnerText??"");
                    if(value.Length is >=3 and <=180 && !Regex.IsMatch(value,@"^(descri[cç][aã]o|produto|item|c[oó]digo)$",RegexOptions.IgnoreCase))
                        products.Add(value);
                }
            }
            products=products.Distinct(StringComparer.OrdinalIgnoreCase).Take(80).ToList();
            var paymentLabel=Capture(plain,@"(?:Forma\s*de\s*Pagamento|Meio\s*de\s*Pagamento|Pagamento)\s*[:\-]?\s*(Cart[aã]o\s*de\s*D[eé]bito|Cart[aã]o\s*de\s*Cr[eé]dito|D[eé]bito|Cr[eé]dito|PIX|Dinheiro|Boleto|Transfer[eê]ncia)",false);
            var payment=NormalizePayment(paymentLabel);
            var category=SuggestCategory(products);
            var paid=payment is "Débito" or "Pix" or "Dinheiro";
            var hasData=issuer!=null||total.HasValue||date.HasValue||products.Count>0||payment!=null;
            return new(issuer,total,date,payment,products,category,paid,hasData,
                hasData?"Consulta fiscal concluída. Confira os dados antes de salvar.":"A SEFAZ respondeu, mas não foi possível identificar com segurança os campos da compra.");
        } catch(OperationCanceledException)when(!cancellationToken.IsCancellationRequested){
            return Fail("O portal fiscal demorou a responder. Tente novamente.");
        } catch(HttpRequestException){
            return Fail("Não foi possível estabelecer conexão segura com o portal fiscal.");
        } catch(Exception exception)when(exception is IOException or ArgumentException or InvalidOperationException){
            return Fail("O portal retornou um documento que não pôde ser interpretado.");
        }
    }

    private static bool IsOfficialConsultation(Uri uri)=>
        uri.Scheme=="https" && uri.UserInfo.Length==0 && uri.Port==443 &&
        uri.Host.EndsWith(".gov.br",StringComparison.OrdinalIgnoreCase) &&
        (uri.AbsolutePath.Contains("nfce",StringComparison.OrdinalIgnoreCase) ||
         uri.AbsolutePath.Contains("consulta",StringComparison.OrdinalIgnoreCase)) &&
        uri.AbsoluteUri.Length<=2400;
    private static System.Text.Encoding TryEncoding(string name){
        try{return System.Text.Encoding.GetEncoding(name.Trim('"'));}
        catch(ArgumentException){return System.Text.Encoding.UTF8;}
    }
    private static string Clean(string raw)=>
        Regex.Replace(WebUtility.HtmlDecode(raw??""),@"[ \t\u00a0]+"," ").Trim();
    private static string? FromCss(HtmlDocument document,string[] classes){
        foreach(var cls in classes){
            var node=document.DocumentNode.SelectSingleNode("//*[contains(concat(' ',normalize-space(@class),' '),' "+cls+" ')]")
                ??document.GetElementbyId(cls);
            var value=Clean(node?.InnerText??"");
            if(value.Length is >2 and <150)return value;
        }
        return null;
    }
    private static bool ValidIssuer(string? name)=>!string.IsNullOrWhiteSpace(name)&&name.Length is >=4 and <=140
        && Regex.IsMatch(name,@"[A-Za-zÀ-ÿ]{3,}")
        && !Regex.IsMatch(name,@"^(DANFE|NFC.E|CONSULTA|CHAVE DE ACESSO|NOTA FISCAL)",RegexOptions.IgnoreCase);
    private static string? Capture(string text,string pattern,bool multiline)=>
        Regex.Match(text,pattern,RegexOptions.IgnoreCase|(multiline?RegexOptions.Singleline:RegexOptions.None))
            is {Success:true} m?Clean(m.Groups[1].Value):null;
    private static decimal? AmountByCss(HtmlDocument document,string[] classes){
        foreach(var cls in classes){
            var found=document.DocumentNode.SelectNodes("//*[contains(concat(' ',normalize-space(@class),' '),' "+cls+" ')]")
                ??(document.GetElementbyId(cls) is { } element?new HtmlNodeCollection(null){element}:null);
            if(found==null)continue;
            foreach(var node in found){
                if(TryAmount(Clean(node.InnerText),out var amount))return amount;
            }
        }
        return null;
    }
    private static decimal? AmountByLabel(string text,string label){
        var match=Regex.Match(text,label+@"\s*[:\-]?\s*(?:R\$\s*)?([\d\.]+,\d{2}|\d+\.\d{2})",RegexOptions.IgnoreCase);
        return match.Success&&TryAmount(match.Groups[1].Value,out var amount)?amount:null;
    }
    private static bool TryAmount(string raw,out decimal amount){
        var text=Regex.Match(raw,@"(?:R\$\s*)?([\d\.]+,\d{2}|\d+\.\d{2})").Groups[1].Value;
        var pt=CultureInfo.GetCultureInfo("pt-BR");
        if(decimal.TryParse(text,NumberStyles.Number,pt,out amount)&&amount>0&&amount<=999999999999.99m)return true;
        if(decimal.TryParse(text,NumberStyles.AllowDecimalPoint,CultureInfo.InvariantCulture,out amount)&&amount>0&&amount<=999999999999.99m)return true;
        return false;
    }
    private static string? NormalizePayment(string? value){
        if(value==null)return null;
        var clean=value.ToLowerInvariant();
        if(clean.Contains("pix"))return "Pix";
        if(clean.Contains("débito")||clean.Contains("debito"))return "Débito";
        if(clean.Contains("crédito")||clean.Contains("credito"))return "Crédito";
        if(clean.Contains("dinheiro"))return "Dinheiro";
        if(clean.Contains("boleto"))return "Boleto";
        if(clean.Contains("transfer"))return "Transferência";
        return null;
    }
    private static string? SuggestCategory(IReadOnlyList<string> items){
        if(items.Count==0)return null;
        string? category=null;
        foreach(var raw in items){
            var item=Regex.Replace(raw.Normalize(System.Text.NormalizationForm.FormD),@"\p{Mn}","").ToLowerInvariant();
            var food=Regex.IsMatch(item,@"\b(arroz|feijao|pao|leite|carne|frango|banana|maca|iogurte|biscoito|macarrao|queijo|cafe|manteiga)\b");
            var clothing=Regex.IsMatch(item,@"\b(camisa|camiseta|calca|bermuda|blusa|vestido|tenis|sapato|meia|jaqueta)\b");
            var transport=Regex.IsMatch(item,@"\b(gasolina|diesel|etanol|combustivel)\b");
            var count=(food?1:0)+(clothing?1:0)+(transport?1:0);
            if(count!=1)return null;
            var current=food?"Alimentação":clothing?"Vestuário":"Transporte";
            if(category!=null && category!=current)return null;
            category=current;
        }
        return category;
    }
}
