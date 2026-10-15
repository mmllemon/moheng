import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  BudgetXlsxError,
  buildBudgetImportTemplate,
  decodeBudgetXlsx,
  inspectBudgetImportWorkbook,
} from './budget-xlsx.js';

async function makeWorkbook(fill: (sheet: ExcelJS.Worksheet) => void): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('目标成本清单');
  fill(sheet);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test('budget template contains native workbook sheets, fixed headers and filling instructions', async () => {
  const buffer = await buildBudgetImportTemplate();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['目标成本清单', '填报说明']);
  assert.equal(workbook.getWorksheet('目标成本清单')!.getCell('A1').value, '清单编号');
  assert.equal(workbook.getWorksheet('目标成本清单')!.getCell('A2').numFmt, '@');
  assert.match(String(workbook.getWorksheet('填报说明')!.getCell('B7').value), /手工目标合价/);
});

test('budget workbook parser preserves text IDs and reports numeric cell types', async () => {
  const buffer = await makeWorkbook((sheet) => {
    sheet.addRow(['清单编号', '清单名称', '上级清单编号', '工程量', '综合单价(元)', '目标合价(元)']);
    sheet.addRow(['000123', '土方开挖', '', 12.5, 18.5, 231.25]);
    sheet.addRow([123, '编号被保存为数字', '', 1, 2, 2]);
  });
  const result = await inspectBudgetImportWorkbook(buffer);
  assert.equal(result.sheetName, '目标成本清单');
  assert.equal(result.rows[0]![0], '000123');
  assert.equal(result.cellTypes[0]![0], 'text');
  assert.equal(result.cellTypes[0]![3], 'number');
  assert.equal(result.cellTypes[1]![0], 'number');
});

test('budget workbook parser rejects formula cells rather than trusting cached formula results', async () => {
  const buffer = await makeWorkbook((sheet) => {
    sheet.addRow(['清单编号', '清单名称']);
    sheet.addRow(['001', { formula: '1+1', result: 2 }]);
  });
  await assert.rejects(
    () => inspectBudgetImportWorkbook(buffer),
    (error: unknown) => error instanceof BudgetXlsxError && error.code === 'XLSX_FORMULAS_NOT_ALLOWED',
  );
});

test('budget XLSX decoder rejects wrong extensions, invalid base64 and non-ZIP payloads', () => {
  assert.throws(() => decodeBudgetXlsx('cost.xlsm', 'UEs='), /仅接受/);
  assert.throws(() => decodeBudgetXlsx('cost.xlsx', 'not base64'), /编码不正确/);
  assert.throws(() => decodeBudgetXlsx('cost.xlsx', Buffer.from('plain text').toString('base64')), /不是有效的 XLSX/);
  assert.throws(() => decodeBudgetXlsx('cost.xlsx', Buffer.from([0x50, 0x4b, 0x03, 0x04]).toString('base64')), /ZIP 中央目录/);
});


test('ZIP preflight accepts a generated XLSX and rejects a claimed oversized uncompressed entry', async () => {
  const buffer = await makeWorkbook((sheet) => { sheet.addRow(['清单编号', '清单名称']); sheet.addRow(['001', '测试']); });
  assert.doesNotThrow(() => decodeBudgetXlsx('valid.xlsx', buffer.toString('base64')));
  const oversized = Buffer.from(buffer);
  const centralDirectory = oversized.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(centralDirectory >= 0);
  oversized.writeUInt32LE(17 * 1024 * 1024, centralDirectory + 24);
  assert.throws(
    () => decodeBudgetXlsx('oversized.xlsx', oversized.toString('base64')),
    (error: unknown) => error instanceof BudgetXlsxError && error.code === 'XLSX_ZIP_ENTRY_TOO_LARGE',
  );
});
