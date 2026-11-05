using System.Globalization;
using System.Text.RegularExpressions;

namespace Atlas.Services;

// Conservative parser: accepts NFC-e/NF-e keys, never fabricates financial fields.
// Public portals sometimes demand CAPTCHA/JavaScript; in that case the form stays editable.
public static class FiscalQrService {
    public sealed record Preview(string? AccessKey,string? IssuerCnpj,string? IssuerName,
        DateTime? IssueDate,decimal? Amount,string? ConsultationUrl,string Message,bool ReliableAmount,bool HasExactIssueDate);

    public static Preview Parse(string? raw) {
        var value=raw?.Trim()??"";
        if(value.Length==0 || value.Length>2400)
            throw new ArgumentException("Informe um QR Code ou link fiscal válido.");
        Uri? link=null;
        if(Uri.TryCreate(value,UriKind.Absolute,out var url) && (url.Scheme=="https"||url.Scheme=="http")) {
            if(url.UserInfo.Length>0 || url.Port is not (80 or 443) || !IsFiscalHost(url.Host))
                throw new ArgumentException("O link deve ser de um portal fiscal oficial (gov.br).");
            link=url;
        } else if(value.Contains("://")||value.Contains('/')||value.Contains('?')) {
            throw new ArgumentException("O conteúdo não é uma chave fiscal nem uma URL oficial válida.");
        }
        var query=link?.Query.TrimStart('?')??"";
        var encoded=GetQueryParameter(query,"p");
        var fiscalPart=Uri.UnescapeDataString(encoded??value);
        // NFC-e p=chave|versao|ambiente|...; also accepts plain 44-digit key.
        var match=Regex.Match(fiscalPart,@"(?<!\d)\d{44}(?!\d)");
        if(!match.Success && link is not null)
            match=Regex.Match(Uri.UnescapeDataString(link.ToString()),@"(?<!\d)\d{44}(?!\d)");
        if(!match.Success || !ValidAccessKey(match.Value))
            throw new ArgumentException("Não foi encontrada uma chave NFC-e/NF-e válida de 44 dígitos.");
        var key=match.Value;
        var model=key.Substring(20,2);
        if(model!="65" && model!="55")
            throw new ArgumentException("A chave não corresponde a uma NFC-e ou NF-e.");
        var year=2000+int.Parse(key.Substring(2,2),CultureInfo.InvariantCulture);
        var month=int.Parse(key.Substring(4,2),CultureInfo.InvariantCulture);
        DateTime? date=year is >=2000 and <=2100 && month is >=1 and <=12?new DateTime(year,month,1):null;
        decimal? total=null;
        var fields=fiscalPart.Split('|');
        // The online QR formats typically contain only key/version/environment.
        // Offline QR may include the exact issue day and the fiscal total.
        var offline=fields.Length>=6 && fields[0]==key &&
            (fields[1]=="2" || fields[1]=="3") &&
            (fields[2]=="1" || fields[2]=="2") &&
            fields[3].Length==2 && fields[3].All(char.IsDigit);
        var exactDate=false;
        if(offline && date.HasValue &&
            int.TryParse(fields[3],NumberStyles.None,CultureInfo.InvariantCulture,out var fiscalDay) &&
            fiscalDay>=1 && fiscalDay<=DateTime.DaysInMonth(year,month))
            { date=new DateTime(year,month,fiscalDay); exactDate=true; }
        // In QR Code 2/3 offline the fifth field is vNF. Online QR code does not
        // contain a reliable amount. Never use any arbitrary digits as a price.
        if(offline && decimal.TryParse(fields[4],NumberStyles.AllowDecimalPoint,CultureInfo.InvariantCulture,out var amount)
            && amount>0 && amount<=999999999999.99m)total=amount;
        return new Preview(key,key.Substring(6,14),null,date,total,
            link?.ToString(),
            total.HasValue
                ?"Valor encontrado no QR Code fiscal; confira na nota antes de registrar."
                :"Chave fiscal identificada. Este QR Code não contém valor confiável; consulte a nota e preencha o valor.",
            total.HasValue,exactDate);
    }

    public static bool ValidAccessKey(string value){
        if(!Regex.IsMatch(value,@"^\d{44}$"))return false;
        var weight=2;var sum=0;
        for(var i=42;i>=0;i--){sum+=(value[i]-'0')*weight;weight=weight==9?2:weight+1;}
        var digit=11-sum%11;if(digit>=10)digit=0;
        return digit==value[43]-'0';
    }

    private static bool IsFiscalHost(string hostname) =>
        hostname.Equals("gov.br",StringComparison.OrdinalIgnoreCase) ||
        hostname.EndsWith(".gov.br",StringComparison.OrdinalIgnoreCase);

    private static string? GetQueryParameter(string query,string name){
        foreach(var pair in query.Split('&',StringSplitOptions.RemoveEmptyEntries)){
            var index=pair.IndexOf('=');
            if(index<0)continue;
            if(Uri.UnescapeDataString(pair[..index]).Equals(name,StringComparison.OrdinalIgnoreCase))
                return Uri.UnescapeDataString(pair[(index+1)..].Replace("+","%20"));
        }
        return null;
    }
}
