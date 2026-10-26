/// <reference types="vite/client" />

// CSS Modules 类型声明。
// Vite 自带 vite/client 已覆盖 *.module.css，但本项目此前从未用过 CSS Modules，
// 缺声明会让 tsc 报 TS2307。显式声明一份，顺带把命名导出的类型收窄为 string。

declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
