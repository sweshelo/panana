.syntax unified
.arm
.arch armv6k
.section .text.bridges,"ax",%progbits
.macro trampoline name, instruction, resume
.global \name
.type \name,%function
\name:
  \instruction
  ldr pc, =\resume
.endm
trampoline original_open, "push {r4,r5,r6,lr}", 0x3378a0
trampoline original_exists, "push {r4,r5,r6,lr}", 0x2ecdac
trampoline original_seek, "mov ip,r2", 0x337920
trampoline original_read, "push {r3,lr}", 0x337950
trampoline original_write, "push {lr}", 0x2cef54
trampoline original_close, "push {r4,r5,r6,lr}", 0x3378e4
trampoline original_destroy, "push {r4,r5,r6,lr}", 0x33b884
trampoline original_flush, "add r0,r0,#16", 0x31ae68
trampoline original_format, "push {r3,r4,r5,lr}", 0x3fdd6c
trampoline original_commit, "ldr r0,=0x574580", 0x31ae34
trampoline original_save, "push {r3-r11,lr}", 0x3fe000
trampoline original_dispose, "push {r4-r6,lr}", 0x3fe4d0

/* Same stack/register contract as native 2bbf54 at its post-OpenArchive boundary. */
.global mount_ext
.type mount_ext,%function
mount_ext:
  push {r4-r8,lr}
  sub sp,sp,#32
  ldr r4,=mount_name
  ldr r6,=0x574a20
  mov r0,#1
  str r0,[sp,#16]
  ldr r0,=0xa79
  str r0,[sp,#20]
  mov r0,#0
  str r0,[sp,#24]
  add r0,sp,#16
  str r0,[sp]
  mov r0,#12
  str r0,[sp,#4]
  ldr r0,[r6,#16]
  str r0,[sp,#28]
  add r0,sp,#28
  add r1,sp,#8
  mov r2,#6
  mov r3,#2
  ldr ip,=0x2bbef4
  blx ip
  ldr pc,=0x2bbf9c

/* libctru FSUSER_CreateExtSaveData IPC 0x8510242; FS_ExtSaveDataInfo is packed 16 bytes. */
.global create_ext
.type create_ext,%function
create_ext:
  push {r4,lr}
  mrc p15,0,r4,c13,c0,3
  add r4,r4,#0x80
  ldr r0,=0x8510242
  str r0,[r4]
  mov r0,#1
  str r0,[r4,#4]
  ldr r0,=0xa79
  str r0,[r4,#8]
  mov r0,#0
  str r0,[r4,#12]
  str r0,[r4,#16]
  str r0,[r4,#20] /* directories */
  mov r0,#2
  str r0,[r4,#24] /* files */
  ldr r0,=0x100000
  str r0,[r4,#28] /* quota including fixed A/B files */
  mov r0,#0
  str r0,[r4,#32]
  str r0,[r4,#36] /* no icon */
  mov r0,#10
  str r0,[r4,#40] /* IPC_BUFFER_R descriptor, size 0 */
  mov r0,#0
  str r0,[r4,#44]
  ldr r0,=0x574a20
  ldr r0,[r0,#16]
  svc #0x32
  cmp r0,#0
  ldrge r0,[r4,#4]
  pop {r4,pc}
.ltorg
.section .rodata.mount,"a",%progbits
.balign 4
mount_name: .asciz "pns:"
