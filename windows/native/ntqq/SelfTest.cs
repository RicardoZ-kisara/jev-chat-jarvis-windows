using System.Buffers.Binary;
using System.Security.Cryptography;

internal static class SelfTest {
    private static void Assert(bool pass) {if(!pass)throw new Exception("Native self-test failed");}
    internal static int Run() {
        var key=Enumerable.Range(0,32).Select(i=>(byte)i).ToArray();
        var salt=Enumerable.Range(32,16).Select(i=>(byte)i).ToArray();
        var plain=new byte[4096];new Random(42).NextBytes(plain);
        "SQLite format 3\0"u8.CopyTo(plain);plain[18]=1;plain[21]=64;plain[22]=32;plain[23]=32;
        Array.Clear(plain,4048,48);var encrypted=new byte[4096];salt.CopyTo(encrypted,0);
        var iv=Enumerable.Repeat((byte)73,16).ToArray();iv.CopyTo(encrypted,4048);
        using(var aes=Aes.Create()){aes.Key=key;aes.IV=iv;aes.Padding=PaddingMode.None;using var encrypt=aes.CreateEncryptor();encrypt.TransformFinalBlock(plain,16,4032).CopyTo(encrypted,16);}
        var macKey=Rfc2898DeriveBytes.Pbkdf2(key,salt.Select(x=>(byte)(x^0x3a)).ToArray(),2,HashAlgorithmName.SHA512,32);
        using(var hmac=new HMACSHA1(macKey)){hmac.ComputeHash(encrypted.Skip(16).Take(4048).Concat(new byte[]{1,0,0,0}).ToArray()).CopyTo(encrypted,4064);}
        using(var cipher=new PageCipher(key,salt)){
            Assert(cipher.Decode(encrypted,1).SequenceEqual(plain));encrypted[200]^=1;
            bool rejected=false;try{cipher.Decode(encrypted,1);}catch(InvalidDataException){rejected=true;}Assert(rejected);
        }
        var dir=Path.Combine(Path.GetTempPath(),"jev-ntqq-selftest-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(dir);
        var file=Path.Combine(dir,"fixture-wal");
        try {
            uint a=0,b=0;
            void Check(byte[] bytes){for(int i=0;i<bytes.Length;i+=8){a=unchecked(a+BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(i,4))+b);b=unchecked(b+BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(i+4,4))+a);}}
            void Put(byte[] bytes,int offset,uint value)=>BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(offset,4),value);
            var header=new byte[32];Put(header,0,0x377f0682);Put(header,4,3007000);Put(header,8,4096);Put(header,16,51);Put(header,20,75);Check(header[..24]);Put(header,24,a);Put(header,28,b);
            using(var output=File.Create(file)){
                output.Write(header);
                foreach(var (pg,size) in new[]{(1u,2u),(2u,0u)}){
                    var fh=new byte[24];Put(fh,0,pg);Put(fh,4,size);header.AsSpan(16,8).CopyTo(fh.AsSpan(8));Check(fh[..8]);Check(encrypted);Put(fh,16,a);Put(fh,20,b);output.Write(fh);output.Write(encrypted);
                }
            }
            var valid=Wal.Inspect(file);Assert(valid.Size==2&&valid.Frames==1&&valid.Pages.ContainsKey(1)&&!valid.Pages.ContainsKey(2)&&valid.Ignored==4120);
            var broken=File.ReadAllBytes(file);broken[100]^=1;File.WriteAllBytes(file,broken);
            bool refused=false;try{Wal.Inspect(file);}catch(InvalidDataException){refused=true;}Assert(refused);
            Program.Emit(new{ok=true,checks=new[]{"page_roundtrip","page_hmac_tamper_rejected","committed_wal_only","wal_checksum_tamper_rejected"}});return 0;
        }finally{File.Delete(file);Directory.Delete(dir);CryptographicOperations.ZeroMemory(key);CryptographicOperations.ZeroMemory(macKey);}
    }
}
