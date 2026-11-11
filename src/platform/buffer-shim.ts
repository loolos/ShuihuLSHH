// 解析器（src/formats）沿用 Node 的 Buffer 接口；浏览器里用 npm 的 buffer 包补上。
// 必须在任何解析器之前导入。
import { Buffer } from 'buffer';

(globalThis as { Buffer?: typeof Buffer }).Buffer ??= Buffer;
