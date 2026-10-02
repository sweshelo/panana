// Hands bytes to the browser as a file to save.

export function download(data: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([data as BlobPart]));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
