// 连 hana 运行时的 CDP，读会话卡片的真实几何与圆角
import { spawn } from 'node:child_process';

const PORT = 9333;
const chrome = 'C:/Users/leema/AppData/Local/HanaAgent/app-1.1.35/resources/electron.exe';
console.log('（若 CDP 不可用，改从 Electron 主进程端口探测）');
