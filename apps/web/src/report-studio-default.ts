import type { ReportStudioBinding, ReportStudioDefinition, ReportStudioDomain, ReportStudioRegion } from './report-studio-types';

function cell(value: unknown, style?: Record<string, unknown>) { return style ? { v: value, s: style } : { v: value }; }
const titleStyle = { ff: 'Microsoft YaHei', fs: 18, bl: true, cl: { rgb: '#17324D' }, ht: 2, vt: 2 };
const sectionStyle = { ff: 'Microsoft YaHei', fs: 12, bl: true, cl: { rgb: '#FFFFFF' }, bg: { rgb: '#244E72' }, ht: 1, vt: 2 };
const labelStyle = { ff: 'Microsoft YaHei', fs: 10, bl: true, cl: { rgb: '#35475D' }, bg: { rgb: '#EEF3F8' }, ht: 1, vt: 2, bd: { t: { s: 1, cl: { rgb: '#D7E0EA' } }, b: { s: 1, cl: { rgb: '#D7E0EA' } }, l: { s: 1, cl: { rgb: '#D7E0EA' } }, r: { s: 1, cl: { rgb: '#D7E0EA' } } } };
const valueStyle = { ff: 'Microsoft YaHei', fs: 10, cl: { rgb: '#172B3D' }, vt: 2, bd: { t: { s: 1, cl: { rgb: '#D7E0EA' } }, b: { s: 1, cl: { rgb: '#D7E0EA' } }, l: { s: 1, cl: { rgb: '#D7E0EA' } }, r: { s: 1, cl: { rgb: '#D7E0EA' } } } };
const headerStyle = { ff: 'Microsoft YaHei', fs: 10, bl: true, cl: { rgb: '#FFFFFF' }, bg: { rgb: '#476C8F' }, ht: 2, vt: 2, tb: 1, bd: { t: { s: 1, cl: { rgb: '#D7E0EA' } }, b: { s: 1, cl: { rgb: '#D7E0EA' } }, l: { s: 1, cl: { rgb: '#D7E0EA' } }, r: { s: 1, cl: { rgb: '#D7E0EA' } } } };
const borderStyle = { t: { s: 1, cl: { rgb: '#D7E0EA' } }, b: { s: 1, cl: { rgb: '#D7E0EA' } }, l: { s: 1, cl: { rgb: '#D7E0EA' } }, r: { s: 1, cl: { rgb: '#D7E0EA' } } };
function rowsFrom(data: string[][]) {
  const cellData: Record<string, Record<string, ReturnType<typeof cell>>> = {};
  data.forEach((row, r) => row.forEach((value, c) => { if (value !== '') (cellData[String(r)] ??= {})[String(c)] = cell(value); }));
  return cellData;
}

function addBindingPlaceholders(workbookInput: unknown, bindings: ReportStudioBinding[]) {
  const workbook = workbookInput as { sheets?: Record<string, { cellData?: Record<string, Record<string, { v?: unknown; s?: unknown }>> }> };
  for (const binding of bindings) {
    const match = /^([A-Z]{1,3})([1-9]\d*)$/.exec(binding.cell);
    const sheet = workbook.sheets?.[binding.sheetId];
    if (!match || !sheet) continue;
    let column = 0;
    for (const character of match[1]!) column = column * 26 + character.charCodeAt(0) - 64;
    const rowKey = String(Number(match[2]) - 1);
    const columnKey = String(column - 1);
    const row = (sheet.cellData ??= {})[rowKey] ??= {};
    const existing = row[columnKey] ?? {};
    row[columnKey] = { ...existing, v: `{{${binding.sourceId}.${binding.fieldId}}}` };
  }
}

function defaultProjectData() {
  const cellData = rowsFrom([
    ['项目综合经营报告'],
    ['项目摘要'],
    ['项目名称', '', '项目编号', '', '业主单位', ''],
    ['当前有效合同额', '', '累计登记净收款', '', '登记净应收合计', ''],
    [''],
    ['主合同信息'],
    ['主合同编号', '', '主合同名称', '', '原始金额', ''],
    [''],
    ['分供合同明细'],
    ['合同编号', '合同名称', '往来单位', '合同状态', '当前合同额', '签订日期'],
    [''],
    ['业主收款与退款流水'],
    ['流水编号', '类型', '金额', '到账日期', '参考号', '备注'],
    [''],
    ['项目成本及其他指标'],
    ['末级目标成本合计', '', '已录入实际成本合计', '', '已登记净应付合计', ''],
    [''],
    ['变更签证清单'],
    ['变更编号', '名称', '类型', '外部确认状态', '外部确认金额', '生效日期'],
  ]);
  const put = (r: number, c: number, v: unknown, s?: Record<string, unknown>) => { (cellData[String(r)] ??= {})[String(c)] = cell(v, s); };
  put(0, 0, '项目综合经营报告', titleStyle);
  for (const [r, c, v] of [[1,0,'项目摘要'],[5,0,'主合同信息'],[8,0,'分供合同明细'],[11,0,'业主收款与退款流水'],[14,0,'项目成本及其他指标'],[17,0,'变更签证清单']] as Array<[number, number, string]>) put(r,c,v,sectionStyle);
  for (const r of [2,3,6,15]) for (const c of [0,2,4]) if (cellData[String(r)]?.[String(c)]) put(r,c,cellData[String(r)]![String(c)]!.v,labelStyle);
  for (const r of [2,3,6,15]) for (const c of [1,3,5]) put(r,c,'',valueStyle);
  for (const r of [9,12,18]) for (let c = 0; c < 6; c += 1) put(r,c,cellData[String(r)]![String(c)]!.v,headerStyle);
  for (const regionRow of [10,13,19]) for (let c = 0; c < 6; c += 1) put(regionRow,c,'', { ...valueStyle, ...(c === 4 ? { ht: 3 } : {}) });
  const merges = [1,5,8,11,14,17].map((r) => ({ startRow: r, startColumn: 0, endRow: r, endColumn: 5 }));
  merges.push({ startRow: 0, startColumn: 0, endRow: 0, endColumn: 5 });
  const workbook = { id: 'moheng-project-studio', name: '项目综合经营报告', appVersion: '1.0.4', locale: 'zhCN', styles: {}, sheetOrder: ['sheet1'], sheets: { sheet1: { id: 'sheet1', name: '项目综合报告', rowCount: 80, columnCount: 12, defaultColumnWidth: 100, defaultRowHeight: 24, mergeData: merges, cellData, rowData: { '0': { h: 34 }, '1': { h: 28 }, '5': { h: 28 }, '8': { h: 26 }, '11': { h: 26 }, '14': { h: 26 }, '17': { h: 26 } }, columnData: { '0': { w: 140 }, '1': { w: 135 }, '2': { w: 140 }, '3': { w: 125 }, '4': { w: 140 }, '5': { w: 130 } }, showGridlines: 1, freeze: { startRow: -1, startColumn: -1, ySplit: 3, xSplit: 0 } } } };
  const bindings: ReportStudioBinding[] = [
    ['B3','project','name'], ['D3','project','code'], ['F3','project','ownerName'],
    ['B4','financialSummary','effectiveContractAmount'], ['D4','financialSummary','netReceipts'], ['F4','financialSummary','issuedReceivableNetAmount'],
    ['B7','mainContract','contractNo'], ['D7','mainContract','name'], ['F7','mainContract','amount'],
    ['B16','financialSummary','targetCostTotal'], ['D16','financialSummary','actualCostTotal'], ['F16','financialSummary','postedPayableTotal'],
  ].map(([cellAddress, sourceId, fieldId], index) => ({ id: `binding-${index + 1}`, sheetId: 'sheet1', cell: cellAddress!, sourceId: sourceId!, fieldId: fieldId!, format: /Amount|Receipts|Total/i.test(fieldId!) ? 'MONEY' as const : 'AUTO' as const }));
  const regionBindingSet: Array<[number, string, string[]]> = [
    [10, 'downstreamContracts', ['contractNo','name','counterpartyName','status','effectiveAmount','signedAt']],
    [13, 'ownerReceipts', ['receiptNo','type','amount','receivedAt','referenceNo','notes']],
    [19, 'changes', ['code','name','type','externalStatus','confirmedAmount','effectiveAt']],
  ];
  const regions: ReportStudioRegion[] = regionBindingSet.map(([templateRow, sourceId], index) => ({ id: `region-${index+1}`, sheetId: 'sheet1', sourceId, templateRow, startColumn: 0, endColumn: 5, maxRows: 10000 }));
  for (const [row, sourceId, fields] of regionBindingSet) fields.forEach((fieldId, c) => bindings.push({ id: `binding-region-${row}-${c}`, sheetId: 'sheet1', cell: `${String.fromCharCode(65 + c)}${row + 1}`, sourceId, fieldId, format: /Amount|amount/i.test(fieldId) ? 'MONEY' : 'AUTO' }));
  addBindingPlaceholders(workbook, bindings);
  return { workbook, bindings, regions };
}
function defaultCompanyData() {
  const cellData = rowsFrom([
    ['公司经营汇总报告'], ['公司核心指标'], ['可访问项目数', '', '当前有效合同额合计', '', '累计登记净收款', ''], ['登记净应收合计', '', '已录入实际成本合计', '', '分供合同当前金额合计', ''], [''], ['项目经营情况'], ['项目编号', '项目名称', '项目状态', '项目负责人', '当前有效合同额', '累计登记净收款', '登记净应收', '实际成本'], [''],
  ]);
  const put = (r: number, c: number, v: unknown, s?: Record<string, unknown>) => { (cellData[String(r)] ??= {})[String(c)] = cell(v, s); };
  put(0,0,'公司经营汇总报告',titleStyle); put(1,0,'公司核心指标',sectionStyle); put(5,0,'项目经营情况',sectionStyle);
  for (const r of [2,3]) for (const c of [0,2,4]) put(r,c,cellData[String(r)]![String(c)]!.v,labelStyle);
  for (const r of [2,3]) for (const c of [1,3,5]) put(r,c,'',valueStyle);
  for (let c=0;c<8;c+=1) put(6,c,cellData['6']![String(c)]!.v,headerStyle);
  for (let c=0;c<8;c+=1) put(7,c,'',valueStyle);
  const workbook = { id: 'moheng-company-studio', name: '公司经营汇总报告', appVersion: '1.0.4', locale: 'zhCN', styles: {}, sheetOrder: ['sheet1'], sheets: { sheet1: { id:'sheet1', name:'公司经营汇总', rowCount:80, columnCount:12, defaultColumnWidth:110, defaultRowHeight:24, mergeData:[{startRow:0,startColumn:0,endRow:0,endColumn:7},{startRow:1,startColumn:0,endRow:1,endColumn:7},{startRow:5,startColumn:0,endRow:5,endColumn:7}], cellData, rowData:{'0':{h:34},'1':{h:28},'5':{h:28}}, columnData:{'0':{w:120},'1':{w:170},'2':{w:100},'3':{w:120},'4':{w:145},'5':{w:145},'6':{w:140},'7':{w:140}}, showGridlines:1, freeze:{startRow:-1,startColumn:-1,ySplit:7,xSplit:0} } } };
  const bindings: ReportStudioBinding[] = [
    ['B3','companySummary','projectCount','NUMBER'], ['D3','companySummary','effectiveContractAmount','MONEY'], ['F3','companySummary','netReceipts','MONEY'],
    ['B4','companySummary','issuedReceivableNetAmount','MONEY'], ['D4','companySummary','actualCostTotal','MONEY'], ['F4','companySummary','downstreamContractTotal','MONEY'],
  ].map(([cellAddress, sourceId, fieldId, format], index) => ({ id:`binding-${index+1}`, sheetId:'sheet1', cell:cellAddress!, sourceId:sourceId!, fieldId:fieldId!, format:format as ReportStudioBinding['format'] }));
  const fields = ['code','name','status','managerName','effectiveContractAmount','netReceipts','issuedReceivableNetAmount','actualCostTotal'];
  const regions: ReportStudioRegion[] = [{ id:'company-projects', sheetId:'sheet1', sourceId:'companyProjects', templateRow:7, startColumn:0, endColumn:7, maxRows:10000 }];
  fields.forEach((fieldId,c) => bindings.push({id:`project-row-${c}`,sheetId:'sheet1',cell:`${String.fromCharCode(65+c)}8`,sourceId:'companyProjects',fieldId,format:/Amount|Receipts|Cost/i.test(fieldId)?'MONEY':'AUTO'}));
  addBindingPlaceholders(workbook, bindings);
  return { workbook, bindings, regions };
}

export function createDefaultStudioDefinition(domain: ReportStudioDomain): ReportStudioDefinition {
  const result = domain === 'PROJECT' ? defaultProjectData() : defaultCompanyData();
  return { schemaVersion:2, domain, title: domain === 'PROJECT' ? '项目综合经营报告' : '公司经营汇总报告', description:'由墨衡报表工作室创建。数据按当前账号有权访问的项目读取。', workbook: result.workbook, bindings: result.bindings, regions: result.regions, page:{paper:'A4',orientation:'landscape',fitToWidth:true,includeMetadata:true,footerText:'墨衡工程经营管理系统'} };
}
