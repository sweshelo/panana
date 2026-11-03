/* RPG2 Japan 1.1.0, ARMv6K. Built by build.ts; no libc, writable globals, or game assets. */
typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;
typedef unsigned long long u64;
typedef int Result;
#define FN(a,t) ((t)(a))
#define CAP 0x40000u
#define PREFIX 128u
#define DISK (CAP+PREFIX)
#define MARK 0x56534e50u
static int missing(Result r) { u32 d=(u32)r&0x3ff;return (((u32)r>>10)&255)==17 && (d==112 || d==113 || d==120); }
#define NOTFOUND(r) missing(r)
typedef struct { u32 vtable; u8 mode,opened,pad[10]; u32 impl,pos,high,end,endHi; } File;
typedef struct { u32 generation,active,size,dirty,busy; u8 image[DISK]; } State;
extern int original_open(File*,const u16*,u32);
extern int original_exists(File*,const u16*);
extern int original_seek(File*,int,int);
extern u32 original_read(File*,void*,u32);
extern u32 original_write(File*,const void*,u32,u32);
extern int original_close(File*);
extern void original_destroy(File*);
extern void original_flush(File*);
extern void original_format(void*);
extern void original_commit(void*);
extern int original_save(void*,u32);
extern void original_dispose(void*);
extern Result mount_ext(void);
extern Result create_ext(void);
#define ctor FN(0x33ba30,void(*)(File*))
#define alloc FN(0x33d690,void*(*)(u32))
#define open_checked FN(0x33ca7c,Result(*)(void*,const u16*,u32))
#define read_checked FN(0x33c908,Result(*)(void*,u32*,void*,u32))
#define write_checked FN(0x361674,Result(*)(void*,u32*,const void*,u32,u32))
#define flush_checked FN(0x3605c0,Result(*)(void*))
#define size_checked FN(0x335460,Result(*)(u64*,void*))
#define find_archive FN(0x333ad8,void*(*)(const u16*))
#define create_file FN(0x3607c8,Result(*)(void*,const void*,u32,u32))
static const u16 paths[2][19] __attribute__((aligned(4))) = {u"pns:/panana-a.bin", u"pns:/panana-b.bin"};
_Static_assert(__builtin_offsetof(File,impl)==16,"native stream ABI");
static int native_valid(State*s) {
  u32*h=(u32*)(s->image+128),n=s->size;
  if(!n)return 1;
  if(n!=0x3b668 || h[0]!=10 || h[2]!=0x178 || h[3]!=0x9ec8 || h[4]!=0x1dbf0 || h[5]!=0x9ec8
    || h[86]!=0xa040 || h[87]!=0x8a80 || h[88]!=0x27ab8 || h[89]!=0x8a80
    || h[90]!=0x12ac0 || h[91]!=0x27b0 || h[92]!=0x30538 || h[93]!=0x27b0)return 0;
  for(u32 i=0;i<16;i++)if(h[6+i]!=0x15270+i*0x898 || h[22+i]!=0x898
    || h[38+i]!=0x32ce8+i*0x898 || (h[54+i] && h[54+i]!=0x898) || h[70+i]>=16)return 0;
  return 1;
}
static void copy(void *to,const void *from,u32 n) { u8 *d=to;const u8*s=from;while(n--)*d++=*s++; }
static void zero(void *p,u32 n) { u8*d=p;while(n--)*d++=0; }
static u32 crc(const u8*p,u32 n,int file) {
  u32 c=~0u,i,k;
  for(i=0;i<n;i++) { c^=file && i>=28 && i<32?0:p[i]; for(k=0;k<8;k++)c=(c>>1)^(0xedb88320u&-(c&1)); }
  return ~c;
}
static void fail(void) { /* Never report a successful save or silently import an older vanilla save. */
  __asm__ volatile("mov r0,#0\nsvc 0x3c":::"r0","memory");
  for(;;){}
}
static State *state(File*f) { return f->high==MARK?(State*)f->impl:0; }
static Result disk_open(File*f,const u16*p,u32 mode) {
  ctor(f);return open_checked(&f->impl,p,mode);
}
static int transfer(File*f,void*p,u32 n,int write) {
  u32 got=0;
  Result r=write?write_checked(&f->impl,&got,p,n,1):read_checked(&f->impl,&got,p,n);
  return r>=0 && got==n;
}
static int valid(State*s) {
  u32*h=(u32*)s->image,*d=h+24;
  return h[0]==MARK && h[1]==1 && h[2]==96 && h[3]==DISK && h[4]==96 && h[5]==1
    && h[8]==0xa7900 && h[9]==0x40000 && !h[22] && !h[23]
    && d[0]==0x4347454c && !d[1] && d[2]==1 && d[3]==1 && d[4]==128
    && d[5]<=CAP && d[7]==1 && d[6]==crc(s->image+128,d[5],0)
    && h[7]==crc(s->image,DISK,1);
}
static int load(State*s,u32 which) {
  File f;u64 size=0;
  Result r=disk_open(&f,paths[which],1);
  if(r<0) { original_close(&f);return NOTFOUND(r)?0:-1; }
  int ok=size_checked(&size,(void*)(f.impl&~1u))>=0 && size==DISK && transfer(&f,s->image,DISK,0) && valid(s);
  original_close(&f);return ok?1:-1;
}
static void commit(State*s) {
  File f;u32*h=(u32*)s->image,*d=h+24,which=s->active^1;
  if(s->generation==~0u)fail();
  h[6]=s->generation+1;d[5]=s->size;d[6]=crc(s->image+128,s->size,0);h[7]=crc(s->image,DISK,1);
  Result r=disk_open(&f,paths[which],3);
  if(r<0 && NOTFOUND(r)) {
    u32 path[3]={4,(u32)(paths[which]+4),28}; /* native SDK descriptor: type, pointer, bytes incl NUL */
    void*a=find_archive(paths[which]);
    if(!a || create_file(a,path,DISK,0)<0)fail();
    r=disk_open(&f,paths[which],3);
  }
  if(r<0 || !transfer(&f,s->image,DISK,1) || flush_checked(&f.impl)<0)fail();
  original_close(&f);
  u32 expected=h[7];
  if(load(s,which)!=1 || ((u32*)s->image)[7]!=expected)fail();
  s->active=which;s->generation=h[6];s->dirty=0;
}
static void envelope(State*s) {
  u32*h=(u32*)s->image,*d=h+24;
  zero(s->image,DISK);
  h[0]=MARK;h[1]=1;h[2]=96;h[3]=DISK;h[4]=96;h[5]=1;h[8]=0xa7900;h[9]=0x40000;
  d[0]=0x4347454c;d[2]=1;d[3]=1;d[4]=128;d[7]=1;
  s->generation=0;s->active=1;s->size=0;s->dirty=0;s->busy=0;
}
/* BL at 3fd800: only the main save existence check, never the trial-import path. */
int save201_start(File*probe,u16*path) {
  u8*controller=(u8*)path-0x210;
  State*s=alloc(sizeof(State));if(!s)fail();
  Result r=mount_ext();
  if(r<0 && NOTFOUND(r)) { if(create_ext()<0)fail();r=mount_ext(); }
  if(r<0)fail();
  int a=load(s,0);u32 ag=((u32*)s->image)[6],ac=((u32*)s->image)[7];
  int b=load(s,1);u32 bg=((u32*)s->image)[6],bc=((u32*)s->image)[7];
  if(a==1 || b==1) {
    if(a==1 && b==1 && ag==bg && ac!=bc)fail();
    u32 which=a==1 && (b!=1 || ag>=bg)?0:1;
    if(load(s,which)!=1)fail();
    s->active=which;s->generation=((u32*)s->image)[6];s->size=((u32*)s->image)[29];s->busy=0;s->dirty=0;
  } else {
    if(a || b)fail(); /* existing but corrupt/inaccessible containers never trigger re-import */
    envelope(s);
    File f;u64 bytes=0;r=disk_open(&f,path,1);
    if(r>=0) {
      if(size_checked(&bytes,(void*)(f.impl&~1u))<0 || bytes<0x178 || bytes>CAP
        || !transfer(&f,s->image+128,(u32)bytes,0))fail();
      s->size=(u32)bytes;
    } else if(!NOTFOUND(r))fail();
    original_close(&f);
    if(!native_valid(s))fail();
    commit(s); /* persist even an empty new-game profile; prevents later accidental re-import */
  }
  ((u32*)path)[0]=MARK;((State**)path)[1]=s;
  if(!native_valid(s))fail();
  controller[0x292]=0; /* native asynchronous File subclass must never see a virtual stream */
  (void)probe;
  return s->size!=0;
}
int save201_open(File*f,const u16*p,u32 mode) {
  if(*(const u32*)p!=MARK)return original_open(f,p,mode);
  State*s=((State*const*)p)[1];
  if(s->busy)return 0;
  s->busy=1;f->impl=(u32)s;f->pos=0;f->high=MARK;f->mode=mode;f->opened=1;
  return 1;
}
int save201_exists(File*f,const u16*p) {
  return *(const u32*)p==MARK?((State*const*)p)[1]->size!=0:original_exists(f,p);
}
int save201_seek(File*f,int off,int whence) {
  State*s=state(f);if(!s)return original_seek(f,off,whence);
  u32 pos=whence==0?0:whence==1?f->pos:s->size;
  if(whence<0 || whence>2 || (off<0 && -(u32)off>pos) || (off>=0 && (u32)off>CAP-pos))fail();
  f->pos=pos+off;return 1;
}
u32 save201_read(File*f,void*p,u32 n) {
  State*s=state(f);if(!s)return original_read(f,p,n);
  if(n>s->size-f->pos || f->pos>s->size)fail();
  copy(p,s->image+128+f->pos,n);f->pos+=n;return n;
}
u32 save201_write(File*f,const void*p,u32 n,u32 flush) {
  State*s=state(f);if(!s)return original_write(f,p,n,flush);
  if(!(f->mode&2) || f->pos>CAP || n>CAP-f->pos)fail();
  copy(s->image+128+f->pos,p,n);f->pos+=n;if(f->pos>s->size)s->size=f->pos;s->dirty=1;return n;
}
void save201_flush(File*f) {
  State*s=state(f);if(!s){original_flush(f);return;}if(s->dirty)commit(s);
}
int save201_close(File*f) {
  State*s=state(f);if(!s)return original_close(f);
  if(s->dirty)commit(s);s->busy=0;f->impl=0;f->high=0;f->opened=0;return 1;
}
void save201_destroy(File*f) { if(state(f))save201_close(f);original_destroy(f); }
/* Native format must not erase the source archive after migration. */
void save201_format(u8*controller) {
  if(*(u32*)(controller+0x210)!=MARK){original_format(controller);return;}
  State*s=*(State**)(controller+0x214);s->size=0;s->dirty=1;commit(s);
}
int save201_save(u8*controller,u32 mode) {
  if(*(u32*)(controller+0x210)==MARK)controller[0x292]=0;
  return original_save(controller,mode);
}
void save201_archive_commit(void*manager) {
  u8*controller=*(u8**)0x5674b4;
  if(!controller || *(u32*)(controller+0x210)!=MARK)original_commit(manager);
}
void save201_dispose(u8*controller) {
  if(*(u32*)(controller+0x210)!=MARK){original_dispose(controller);return;}
  State*s=*(State**)(controller+0x214);
  if(s->busy)fail();
  FN(0x33e51c,void(*)(void*))(s);
  FN(0x2ed39c,Result(*)(const char*))("pns:");
  zero(controller+0x210,8);
  original_dispose(controller); /* closes data:/trial: mounts; does not format or delete them */
}
