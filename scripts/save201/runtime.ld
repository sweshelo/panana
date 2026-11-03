ENTRY(save201_start)
SECTIONS {
  . = 0;
  .payload : { *(.text*) *(.rodata*) . = ALIGN(4); }
  /DISCARD/ : { *(.comment*) *(.ARM.attributes*) *(.ARM.exidx*) *(.ARM.extab*) *(.eh_frame*) }
  .forbidden : { *(.data*) *(.bss*) *(COMMON) }
  ASSERT(SIZEOF(.forbidden) == 0, "runtime must not have writable globals")
}
