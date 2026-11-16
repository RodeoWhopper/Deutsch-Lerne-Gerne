# Generates the ">_" pixel icon (own artwork, no stock image). Pure stdlib PNG writer.
import zlib, struct, sys, os
BG=(0x0E,0x0B,0x05); FG=(0xFF,0xB0,0x00)
# 16x16 pixel grid: ">" then "_"
G=[
"................",
"................",
"..##............",
"...##...........",
"....##..........",
".....##.........",
"......##........",
".....##.........",
"....##..........",
"...##...........",
"..##............",
"................",
"........######..",
"........######..",
"................",
"................",
]
def png(size, pad_frac, path):
    s=size; n=16; pad=int(s*pad_frac); cell=(s-2*pad)//n; off=(s-cell*n)//2
    rows=[]
    for y in range(s):
        row=bytearray([0])
        for x in range(s):
            gx=(x-off)//cell if x>=off else -1; gy=(y-off)//cell if y>=off else -1
            on = 0<=gx<n and 0<=gy<n and G[gy][gx]=='#'
            row+=bytes(FG if on else BG)
        rows.append(bytes(row))
    raw=b''.join(rows)
    def chunk(t,d): c=struct.pack('>I',len(d))+t+d; return c+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
    data=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',s,s,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw,9))+chunk(b'IEND',b'')
    open(path,'wb').write(data)
os.makedirs('public/icons',exist_ok=True)
png(192,0.12,'public/icons/icon-192.png')
png(512,0.12,'public/icons/icon-512.png')
png(512,0.22,'public/icons/icon-maskable-512.png')
png(180,0.12,'public/icons/apple-touch-icon.png')
png(32,0.06,'public/icons/favicon-32.png')
print('ok')
