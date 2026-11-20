// opencc-js 的分词典入口没有类型声明（docs/game-design.md §10.3：繁体按需载入）
declare module 'opencc-js/from/cn' {
  const dict: import('opencc-js/core').DictGroup[];
  export default dict;
}
declare module 'opencc-js/to/tw' {
  const dict: import('opencc-js/core').DictGroup[];
  export default dict;
}
