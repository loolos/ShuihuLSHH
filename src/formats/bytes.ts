// 通用字节读取与文本解码。原版文本为 Big5（.pab/.dab/.hum/EXE），.pas 为 GB2312 副本。
const big5 = new TextDecoder('big5');
const gbk = new TextDecoder('gbk');

export function decodeBig5(b: Uint8Array): string {
  return big5.decode(b);
}
export function decodeGbk(b: Uint8Array): string {
  return gbk.decode(b);
}

/** 读取以 \0 结尾、最长 max 字节的 Big5 字符串。 */
export function cstrBig5(buf: Buffer, off: number, max = 4096): string {
  let end = off;
  const lim = Math.min(buf.length, off + max);
  while (end < lim && buf[end] !== 0) end++;
  return big5.decode(buf.subarray(off, end));
}

export function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
}

export function expectMagic(buf: Buffer, magic: string, file: string): void {
  const got = buf.subarray(0, magic.length).toString('latin1');
  if (got !== magic) throw new Error(`${file}: 魔数应为 ${JSON.stringify(magic)}，实际为 ${JSON.stringify(got)}`);
}
