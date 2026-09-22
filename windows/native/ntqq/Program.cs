using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using NTQlean.Core;

internal sealed record Request(string SourceDb, string Workspace);
internal static class Program {
    internal static void Emit(object value) { Console.WriteLine(JsonSerializer.Serialize(value)); Console.Out.Flush(); }
    private static string Stamp(string file) {var info=new FileInfo(file);return info.Exists?$"{info.Length}:{info.LastWriteTimeUtc.Ticks}":"missing";}
    private static string Hash(string file) {using var stream=ReadOnlyFile.Open(file);return Convert.ToHexString(SHA256.HashData(stream));}
    private static string Copy(string source,string target) {
        using var input=ReadOnlyFile.Open(source);
        using var output=new FileStream(target,FileMode.Create,FileAccess.Write,FileShare.None,4*1024*1024);
        using var hash=IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var buffer=new byte[4*1024*1024];int n;
        while((n=input.Read(buffer))>0){output.Write(buffer,0,n);hash.AppendData(buffer,0,n);}
        return Convert.ToHexString(hash.GetHashAndReset());
    }
    private static int Main(string[] args) {
        Console.InputEncoding=Encoding.UTF8;Console.OutputEncoding=new UTF8Encoding(false);
        if(args.SequenceEqual(new[]{"--self-test"})) return SelfTest.Run();
        try {
            var request=JsonSerializer.Deserialize<Request>(Console.ReadLine()??"",new JsonSerializerOptions{PropertyNameCaseInsensitive=true})??throw new InvalidDataException("INVALID_REQUEST");
            var source=Path.GetFullPath(request.SourceDb);var work=Path.GetFullPath(request.Workspace);
            if(Path.GetFileName(source)!="nt_msg.db" || !source.Contains(Path.DirectorySeparatorChar+"nt_db"+Path.DirectorySeparatorChar)) throw new InvalidDataException("MESSAGE_DATABASE_ONLY");
            if(work.StartsWith(Path.GetDirectoryName(source)!+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)||Directory.Exists(work))throw new InvalidDataException("WORKSPACE_MUST_BE_NEW");
            var header=ReadOnlyFile.ReadBytes(source,0,1040);
            if(!header.AsSpan(32,8).SequenceEqual("QQ_NT DB"u8))throw new InvalidDataException("NTQQ_HEADER_UNSUPPORTED");
            var salt=header.AsSpan(1024,16).ToArray();var saltHex=Convert.ToHexString(salt);
            Emit(new{type="progress",stage="key",message="正在只读匹配当前消息库的内存密钥…"});
            var keys=KeyDumper.DumpAllKeyspecs(null,out var processes,out _,saltHex);
            if(!keys.TryGetValue(saltHex,out var candidates)||candidates.Count==0)throw new InvalidDataException("KEY_NOT_FOUND_LOGIN_REQUIRED");
            Directory.CreateDirectory(work);
            var copy=Path.Combine(work,"encrypted.db");var wal=copy+"-wal";string sourceHash="",walHash="";bool stable=false;
            for(int attempt=0;attempt<3;attempt++) {
                Emit(new{type="progress",stage="snapshot",message="正在复制并校验 QQ 消息库和 WAL…"});
                var before=Stamp(source);var wb=Stamp(source+"-wal");
                sourceHash=Copy(source,copy);
                if(wb!="missing")walHash=Copy(source+"-wal",wal);else{walHash="";if(File.Exists(wal))File.Delete(wal);}
                stable=before==Stamp(source)&&wb==Stamp(source+"-wal")&&sourceHash==Hash(source)&&(wb=="missing"||walHash==Hash(source+"-wal"))&&before==Stamp(source)&&wb==Stamp(source+"-wal");
                if(stable)break;
            }
            if(!stable)throw new InvalidDataException("SOURCE_CHANGED_RETRY");
            using var input=File.OpenRead(copy);input.Position=1024;var first=new byte[4096];input.ReadExactly(first);
            PageCipher? cipher=null;
            foreach(var candidate in candidates) {
                var key=Convert.FromHexString(candidate);
                foreach(var sha256 in new[]{false,true}) {
                    var trial=new PageCipher(key,salt,sha256);
                    try{trial.Decode(first,1);cipher=trial;break;}catch(InvalidDataException){trial.Dispose();}
                }
                CryptographicOperations.ZeroMemory(key);if(cipher!=null)break;
            }
            keys.Clear();candidates.Clear();
            if(cipher==null)throw new InvalidDataException("KEY_OR_CIPHER_UNSUPPORTED");
            using(cipher) {
                var map=Wal.Inspect(wal);var payload=input.Length-1024;
                if(payload<=0||payload%4096!=0)throw new InvalidDataException("DATABASE_SIZE_INVALID");
                long pages=map.Size>0?map.Size:payload/4096;
                if(pages>Math.Max(payload/4096+map.Pages.Count,1))throw new InvalidDataException("WAL_SIZE_INVALID");
                var target=Path.Combine(work,"messages.sqlite");
                using var output=new FileStream(target,FileMode.CreateNew,FileAccess.ReadWrite,FileShare.None,1024*1024);
                using var log=File.Exists(wal)?File.OpenRead(wal):null;
                var page=new byte[4096];long verified=0;
                for(uint number=1;number<=pages;number++) {
                    if(map.Pages.TryGetValue(number,out var offset)){log!.Position=offset;log.ReadExactly(page);}
                    else{input.Position=1024+((long)number-1)*4096;input.ReadExactly(page);}
                    output.Write(cipher.Decode(page,number));verified++;
                    if(number%4096==0)Emit(new{type="progress",stage="decrypt",message=$"正在验证并解密：{number}/{pages} 页…"});
                }
                // WAL commits have already been merged into this private copy.
                output.Position=18;output.Write(new byte[]{1,1});
                var count=new byte[4];System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(count,(uint)pages);output.Position=28;output.Write(count);output.Flush(true);
                var result=new{type="result",ok=true,path=target,pages,verifiedPages=verified,walFrames=map.Frames,walIgnoredBytes=map.Ignored,sourceSha256=sourceHash,walSha256=walHash,processesScanned=processes,capturedAt=DateTime.UtcNow.ToString("O")};
                File.WriteAllText(Path.Combine(work,"snapshot.json"),JsonSerializer.Serialize(result),new UTF8Encoding(false));
                Emit(result);
            }
            return 0;
        } catch(Exception error) {
            // No keys, page plaintext, source content, or raw exception details leave this process.
            var code=error is InvalidDataException?error.Message:error is UnauthorizedAccessException?"ACCESS_DENIED":error is IOException?"FILE_LOCKED_OR_READ_FAILED":"EXTRACTION_FAILED";
            Emit(new{type="result",ok=false,code});return 1;
        }
    }
}
