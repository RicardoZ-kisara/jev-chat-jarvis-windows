// SQLCipher page layout/KDF adapted from NTQlean (MIT), Kevin-2106, 2026.
// See ../../licenses/NTQlean-LICENSE.txt and NTQQ.md for provenance.
using System.Buffers.Binary;
using System.Security.Cryptography;
using NTQlean.Core;

namespace NTQlean.Core { public static class DbHeaderInspector { public const int NtqqHeaderSize = 1024; } }

internal sealed class PageCipher : IDisposable {
    internal const int PageSize = 4096;
    private readonly byte[] key, hmacKey;
    private readonly int hmacSize, reserve;
    internal PageCipher(byte[] key, byte[] salt, bool sha256 = false) {
        this.key = key.ToArray(); hmacSize = sha256 ? 32 : 20; reserve = 48;
        var masked = salt.Select(b => (byte)(b ^ 0x3a)).ToArray();
        hmacKey = Rfc2898DeriveBytes.Pbkdf2(key, masked, 2, HashAlgorithmName.SHA512, 32);
        CryptographicOperations.ZeroMemory(masked);
    }
    internal byte[] Decode(byte[] page, uint pageNumber) {
        if (page.Length != PageSize || pageNumber == 0) throw new InvalidDataException("INVALID_PAGE");
        var start = pageNumber == 1 ? 16 : 0;
        var end = PageSize - reserve;
        using HMAC hmac = hmacSize == 20 ? new HMACSHA1(hmacKey) : new HMACSHA256(hmacKey);
        hmac.TransformBlock(page, start, end + 16 - start, null, 0);
        var pgno = new byte[4]; BinaryPrimitives.WriteUInt32LittleEndian(pgno, pageNumber);
        hmac.TransformFinalBlock(pgno, 0, 4);
        if (!CryptographicOperations.FixedTimeEquals(hmac.Hash!, page.AsSpan(end + 16, hmacSize)))
            throw new InvalidDataException("PAGE_HMAC_FAILED");
        using var aes = Aes.Create(); aes.Key = key;
        var plaintext = aes.DecryptCbc(page.AsSpan(start, end - start), page.AsSpan(end,16), PaddingMode.None);
        var result = new byte[PageSize]; plaintext.CopyTo(result, start);
        if (pageNumber == 1) {
            "SQLite format 3\0"u8.CopyTo(result);
            if (result[21] != 64 || result[22] != 32 || result[23] != 32 || result[18] is not (1 or 2))
                throw new InvalidDataException("SQLITE_HEADER_INVALID");
        }
        return result;
    }
    public void Dispose() { CryptographicOperations.ZeroMemory(key); CryptographicOperations.ZeroMemory(hmacKey); }
}

internal static class Wal {
    private static uint Be(byte[] b, int pos) => BinaryPrimitives.ReadUInt32BigEndian(b.AsSpan(pos,4));
    private static void Checksum(ReadOnlySpan<byte> bytes, bool big, ref uint a, ref uint b) {
        for (int i=0;i<bytes.Length;i+=8) {
            uint x = big ? BinaryPrimitives.ReadUInt32BigEndian(bytes.Slice(i,4)) : BinaryPrimitives.ReadUInt32LittleEndian(bytes.Slice(i,4));
            uint y = big ? BinaryPrimitives.ReadUInt32BigEndian(bytes.Slice(i+4,4)) : BinaryPrimitives.ReadUInt32LittleEndian(bytes.Slice(i+4,4));
            a = unchecked(a+x+b); b = unchecked(b+y+a);
        }
    }
    internal static (Dictionary<uint,long> Pages, uint Size, int Frames, long Ignored) Inspect(string file) {
        var result = new Dictionary<uint,long>();
        if (!File.Exists(file) || new FileInfo(file).Length == 0) return (result,0,0,0);
        using var input = File.OpenRead(file);
        var header = new byte[32]; input.ReadExactly(header);
        var magic = Be(header,0); bool big = magic == 0x377f0683;
        if (magic is not (0x377f0682 or 0x377f0683) || Be(header,4) != 3007000 || Be(header,8) != PageCipher.PageSize)
            throw new InvalidDataException("WAL_HEADER_UNSUPPORTED");
        uint a=0,b=0; Checksum(header.AsSpan(0,24),big,ref a,ref b);
        if (a!=Be(header,24) || b!=Be(header,28)) throw new InvalidDataException("WAL_CHECKSUM_FAILED");
        var pending = new Dictionary<uint,long>(); uint dbSize=0; int frames=0, committed=0; long committedEnd=32;
        var fh=new byte[24];var page=new byte[PageCipher.PageSize];
        while (input.Position+24+PageCipher.PageSize<=input.Length) {
            input.ReadExactly(fh); long offset=input.Position;input.ReadExactly(page);
            if (!fh.AsSpan(8,8).SequenceEqual(header.AsSpan(16,8))) break; // stale frames after WAL reset
            Checksum(fh.AsSpan(0,8),big,ref a,ref b);Checksum(page,big,ref a,ref b);
            if (a!=Be(fh,16) || b!=Be(fh,20)) throw new InvalidDataException("WAL_CHECKSUM_FAILED");
            uint pgno=Be(fh,0),size=Be(fh,4);
            if (pgno==0) throw new InvalidDataException("WAL_PAGE_INVALID");
            pending[pgno]=offset;frames++;
            if(size>0) {foreach(var item in pending)result[item.Key]=item.Value;pending.Clear();dbSize=size;committed=frames;committedEnd=input.Position;}
        }
        return (result,dbSize,committed,input.Length-committedEnd);
    }
}
