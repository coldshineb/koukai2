# Minimal 16-bit x86 (8086/80186/80286 + common 386 ops) disassembler, pure python.
R8 = ["al","cl","dl","bl","ah","ch","dh","bh"]
R16 = ["ax","cx","dx","bx","sp","bp","si","di"]
R32 = ["eax","ecx","edx","ebx","esp","ebp","esi","edi"]
SR = ["es","cs","ss","ds","fs","gs","?6","?7"]
EA = ["bx+si","bx+di","bp+si","bp+di","si","di","bp","bx"]
ALU = ["add","or","adc","sbb","and","sub","xor","cmp"]
SHF = ["rol","ror","rcl","rcr","shl","shr","sal","sar"]
JCC = ["jo","jno","jb","jae","je","jne","jbe","ja","js","jns","jp","jnp","jl","jge","jle","jg"]

def s8(v): return v-256 if v>127 else v
def s16(v): return v-65536 if v>32767 else v
def hx(v):
    t = f"{v:x}h"
    return "0" + t if t[0] in "abcdef" else t

class Ins:
    __slots__=("addr","size","mn","ops","target","raw")
    def __init__(s,addr,size,mn,ops,target=None,raw=b""):
        s.addr=addr;s.size=size;s.mn=mn;s.ops=ops;s.target=target;s.raw=raw
    def __str__(s):
        return f"{s.addr:05x}: {s.raw.hex():<14} {s.mn} {', '.join(s.ops)}"

def disasm_one(b, off, base=0):
    start=off; seg=None; rep=None; opsz=16
    while True:
        o=b[off]
        if o in (0x26,0x2e,0x36,0x3e): seg=SR[(o>>3)&3]; off+=1; continue
        if o==0x64: seg="fs";off+=1;continue
        if o==0x65: seg="gs";off+=1;continue
        if o in (0xf2,0xf3): rep="repne" if o==0xf2 else "rep"; off+=1; continue
        if o==0xf0: off+=1; continue
        if o==0x66: opsz=32; off+=1; continue
        break
    op=b[off]; off+=1
    st={"off":off}
    def u8():
        v=b[st["off"]]; st["off"]+=1; return v
    def u16():
        v=b[st["off"]]|(b[st["off"]+1]<<8); st["off"]+=2; return v
    def u32():
        v=u16(); v|=u16()<<16; return v
    def imm(w): 
        if not w: return u8()
        return u32() if opsz==32 else u16()
    RW = R32 if opsz==32 else R16
    def modrm(w, regtab=None):
        m=u8(); mod=m>>6; reg=(m>>3)&7; rm=m&7
        if mod==3:
            r=(RW if w==1 else R8 if w==0 else R16)[rm]
            return reg,r,m
        pre=(seg+":") if seg else ""
        if mod==0 and rm==6: e=f"[{pre}{u16():04x}h]"
        else:
            d=""
            if mod==1: dv=s8(u8()); d=f"{'+' if dv>=0 else '-'}{hx(abs(dv))}"
            elif mod==2: dv=u16(); d=f"+{dv:04x}h"
            e=f"[{pre}{EA[rm]}{d}]"
        sz={0:"byte ",1:("dword " if opsz==32 else "word "),2:"word ",3:"dword ",4:"far "}.get(w,"")
        return reg,sz+e,m
    mn=None;ops=[];tgt=None
    if op<0x40 and (op&7)<6:
        a=op>>3; k=op&7; mn=ALU[a]
        if k==0: r,e,_=modrm(0); ops=[e,R8[r]]
        elif k==1: r,e,_=modrm(1); ops=[e,RW[r]]
        elif k==2: r,e,_=modrm(0); ops=[R8[r],e]
        elif k==3: r,e,_=modrm(1); ops=[RW[r],e]
        elif k==4: ops=["al",f"{u8():02x}h"]
        elif k==5: ops=["ax" if opsz==16 else "eax",f"{hx(imm(1))}"]
    elif op in (0x06,0x0e,0x16,0x1e): mn="push"; ops=[SR[op>>3]]
    elif op in (0x07,0x17,0x1f): mn="pop"; ops=[SR[op>>3]]
    elif op in (0x27,0x2f,0x37,0x3f): mn={0x27:"daa",0x2f:"das",0x37:"aaa",0x3f:"aas"}[op]
    elif 0x40<=op<0x48: mn="inc"; ops=[RW[op-0x40]]
    elif 0x48<=op<0x50: mn="dec"; ops=[RW[op-0x48]]
    elif 0x50<=op<0x58: mn="push"; ops=[RW[op-0x50]]
    elif 0x58<=op<0x60: mn="pop"; ops=[RW[op-0x58]]
    elif op==0x60: mn="pusha"
    elif op==0x61: mn="popa"
    elif op==0x62: r,e,_=modrm(3); mn="bound"; ops=[R16[r],e]
    elif op==0x63: r,e,_=modrm(2); mn="arpl"; ops=[e,R16[r]]
    elif op==0x68: mn="push"; ops=[f"{hx(imm(1))}"]
    elif op==0x6a: mn="push"; ops=[f"{s8(u8())}"]
    elif op in (0x69,0x6b):
        r,e,_=modrm(1); v=imm(1) if op==0x69 else s8(u8()); mn="imul"; ops=[RW[r],e,f"{v}"]
    elif op in (0x6c,0x6d,0x6e,0x6f): mn=["insb","insw","outsb","outsw"][op-0x6c]
    elif 0x70<=op<0x80:
        d=s8(u8()); tgt=(base+st["off"]+d); mn=JCC[op-0x70]; ops=[f"{tgt:04x}"]
    elif op in (0x80,0x81,0x82,0x83):
        r,e,_=modrm(0 if op in(0x80,0x82) else 1); mn=ALU[r]
        v=u8() if op!=0x81 else imm(1)
        if op==0x83: v=s8(v)&(0xffff if opsz==16 else 0xffffffff)
        ops=[e,f"{hx(v)}"]
    elif op in (0x84,0x85): r,e,_=modrm(op&1); mn="test"; ops=[e,(R8 if op==0x84 else RW)[r]]
    elif op in (0x86,0x87): r,e,_=modrm(op&1); mn="xchg"; ops=[e,(R8 if op==0x86 else RW)[r]]
    elif op in (0x88,0x89,0x8a,0x8b):
        w=op&1; r,e,_=modrm(w); R=RW if w else R8; mn="mov"
        ops=[e,R[r]] if op<0x8a else [R[r],e]
    elif op==0x8c: r,e,_=modrm(2); mn="mov"; ops=[e,SR[r]]
    elif op==0x8d: r,e,_=modrm(-1); mn="lea"; ops=[RW[r],e]
    elif op==0x8e: r,e,_=modrm(2); mn="mov"; ops=[SR[r],e]
    elif op==0x8f: r,e,_=modrm(1); mn="pop"; ops=[e]
    elif op==0x90: mn="nop"
    elif 0x91<=op<0x98: mn="xchg"; ops=["ax",RW[op-0x90]]
    elif op==0x98: mn="cbw" if opsz==16 else "cwde"
    elif op==0x99: mn="cwd" if opsz==16 else "cdq"
    elif op==0x9a:
        o_=u16(); sg=u16(); mn="call far"; ops=[f"{sg:04x}:{o_:04x}"]; tgt=(sg,o_)
    elif op==0x9b: mn="wait"
    elif op==0x9c: mn="pushf"
    elif op==0x9d: mn="popf"
    elif op==0x9e: mn="sahf"
    elif op==0x9f: mn="lahf"
    elif op in (0xa0,0xa1,0xa2,0xa3):
        a=u16(); pre=(seg+":") if seg else ""; m=f"[{pre}{a:04x}h]"; reg="al" if op&1==0 else ("ax" if opsz==16 else "eax")
        mn="mov"; ops=[reg,m] if op<0xa2 else [m,reg]
    elif 0xa4<=op<=0xaf and op not in (0xa8,0xa9):
        mn=["movsb","movsw","cmpsb","cmpsw",None,None,"stosb","stosw","lodsb","lodsw","scasb","scasw"][op-0xa4]
        if opsz==32: mn=mn[:-1]+"d"
        if rep: mn=rep+" "+mn
        if seg: ops=[f"seg={seg}"]
    elif op==0xa8: mn="test"; ops=["al",f"{u8():02x}h"]
    elif op==0xa9: mn="test"; ops=["ax",f"{hx(imm(1))}"]
    elif 0xb0<=op<0xb8: mn="mov"; ops=[R8[op-0xb0],f"{u8():02x}h"]
    elif 0xb8<=op<0xc0: mn="mov"; ops=[RW[op-0xb8],f"{hx(imm(1))}"]
    elif op in (0xc0,0xc1,0xd0,0xd1,0xd2,0xd3):
        w=op&1; r,e,_=modrm(w); mn=SHF[r]
        if op in (0xc0,0xc1): ops=[e,f"{u8()}"]
        elif op in (0xd0,0xd1): ops=[e,"1"]
        else: ops=[e,"cl"]
    elif op==0xc2: mn="ret"; ops=[f"{hx(u16())}"]
    elif op==0xc3: mn="ret"
    elif op==0xc4: r,e,_=modrm(3); mn="les"; ops=[R16[r],e]
    elif op==0xc5: r,e,_=modrm(3); mn="lds"; ops=[R16[r],e]
    elif op==0xc6: r,e,_=modrm(0); mn="mov"; ops=[e,f"{u8():02x}h"]
    elif op==0xc7: r,e,_=modrm(1); mn="mov"; ops=[e,f"{hx(imm(1))}"]
    elif op==0xc8: a=u16(); c=u8(); mn="enter"; ops=[f"{hx(a)}",str(c)]
    elif op==0xc9: mn="leave"
    elif op==0xca: mn="retf"; ops=[f"{hx(u16())}"]
    elif op==0xcb: mn="retf"
    elif op==0xcc: mn="int3"
    elif op==0xcd: mn="int"; ops=[f"{u8():02x}h"]
    elif op==0xce: mn="into"
    elif op==0xcf: mn="iret"
    elif op==0xd4: u8(); mn="aam"
    elif op==0xd5: u8(); mn="aad"
    elif op==0xd7: mn="xlat"
    elif 0xd8<=op<=0xdf: r,e,m=modrm(-1); mn=f"esc{op-0xd8}"; ops=[str(r),e]
    elif op in (0xe0,0xe1,0xe2,0xe3,0xeb):
        d=s8(u8()); tgt=(base+st["off"]+d)
        mn={0xe0:"loopne",0xe1:"loope",0xe2:"loop",0xe3:"jcxz",0xeb:"jmp short"}[op]; ops=[f"{tgt:04x}"]
    elif op in (0xe4,0xe5): mn="in"; ops=["al" if op==0xe4 else "ax",f"{u8():02x}h"]
    elif op in (0xe6,0xe7): mn="out"; ops=[f"{u8():02x}h","al" if op==0xe6 else "ax"]
    elif op in (0xe8,0xe9):
        d=s16(u16()); tgt=(base+st["off"]+d); mn="call" if op==0xe8 else "jmp"; ops=[f"{tgt:04x}"]
    elif op==0xea: o_=u16(); sg=u16(); mn="jmp far"; ops=[f"{sg:04x}:{o_:04x}"]; tgt=(sg,o_)
    elif op==0xec: mn="in"; ops=["al","dx"]
    elif op==0xed: mn="in"; ops=["ax","dx"]
    elif op==0xee: mn="out"; ops=["dx","al"]
    elif op==0xef: mn="out"; ops=["dx","ax"]
    elif op==0xf4: mn="hlt"
    elif op==0xf5: mn="cmc"
    elif op in (0xf6,0xf7):
        w=op&1; r,e,_=modrm(w); mn=["test","test","not","neg","mul","imul","div","idiv"][r]; ops=[e]
        if r<2: ops.append(f"{hx(imm(w))}")
    elif op in (0xf8,0xf9,0xfa,0xfb,0xfc,0xfd): mn=["clc","stc","cli","sti","cld","std"][op-0xf8]
    elif op==0xfe: r,e,_=modrm(0); mn=["inc","dec"][r&1]; ops=[e]
    elif op==0xff:
        sv=st["off"]; m=b[sv]; r=(m>>3)&7
        r,e,_=modrm(4 if r in (3,5) else 1)
        mn=["inc","dec","call","call far","jmp","jmp far","push","?"][r]; ops=[e]
    elif op==0x0f:
        o2=u8()
        if 0x80<=o2<0x90:
            d=s16(u16()); tgt=(base+st["off"]+d); mn=JCC[o2-0x80]; ops=[f"{tgt:04x}"]
        elif o2 in (0xb6,0xb7,0xbe,0xbf):
            r,e,_=modrm(0 if o2 in(0xb6,0xbe) else 2); mn="movzx" if o2<0xb8 else "movsx"; ops=[RW[r],e]
        elif o2 in (0xa0,0xa1,0xa8,0xa9): mn="push" if o2 in(0xa0,0xa8) else "pop"; ops=["fs" if o2<0xa8 else "gs"]
        elif o2 in (0xa4,0xac):
            r,e,_=modrm(1); mn="shld" if o2==0xa4 else "shrd"; ops=[e,RW[r],str(u8())]
        elif o2 in (0xa5,0xad):
            r,e,_=modrm(1); mn="shld" if o2==0xa5 else "shrd"; ops=[e,RW[r],"cl"]
        elif o2==0xaf: r,e,_=modrm(1); mn="imul"; ops=[RW[r],e]
        else: mn=f"0f {o2:02x}?"
    else:
        mn=f"db {op:02x}"
    off=st["off"]
    if rep and not mn.startswith("rep"): mn=rep+" "+mn
    return Ins(base+start, off-start, mn, ops, tgt, bytes(b[start:off]))

def disasm(b, start, end, base=None):
    if base is None: base=0
    off=start; out=[]
    while off<end:
        try: i=disasm_one(b,off,base-start if False else 0)
        except IndexError: break
        out.append(i); off+=i.size
    return out
