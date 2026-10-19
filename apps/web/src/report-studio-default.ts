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

const dateFieldIds = new Set([
  'applyDate', 'date', 'dueAt', 'effectiveAt', 'guaranteeEndAt', 'measureDate',
  'occurredAt', 'paidAt', 'plannedEndDate', 'postedAt', 'receivedAt', 'signedAt',
  'startDate', 'updatedAt',
]);

function defaultRegionFieldFormat(fieldId: string, isMoney: boolean): ReportStudioBinding['format'] {
  if (dateFieldIds.has(fieldId)) return 'DATE';
  return isMoney ? 'MONEY' : 'AUTO';
}

function defaultProjectData() {
  const cellData = rowsFrom([
    ['项目综合经营报告'],
    ['项目摘要'],
    ['项目名称', '', '项目编号', '', '业主单位', ''],
    ['当前有效合同额', '', '累计登记净收款', '', '登记净应收合计', ''],
    ['累计分供净支付', '', '累计分供退款', '', '已登记净应付合计', ''],
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
    [''],
    ['分供合同付款与退款流水'],
    ['合同编号', '类型', '支付/退款金额', '支付日期', '支付参考号', '原付款参考号'],
    [''],
  ]);
  const put = (r: number, c: number, v: unknown, s?: Record<string, unknown>) => { (cellData[String(r)] ??= {})[String(c)] = cell(v, s); };
  put(0, 0, '项目综合经营报告', titleStyle);
  for (const [r, c, v] of [[1,0,'项目摘要'],[5,0,'主合同信息'],[8,0,'分供合同明细'],[11,0,'业主收款与退款流水'],[14,0,'项目成本及其他指标'],[17,0,'变更签证清单'],[20,0,'分供合同付款与退款流水']] as Array<[number, number, string]>) put(r,c,v,sectionStyle);
  for (const r of [2,3,4,6,15]) for (const c of [0,2,4]) if (cellData[String(r)]?.[String(c)]) put(r,c,cellData[String(r)]![String(c)]!.v,labelStyle);
  for (const r of [2,3,4,6,15]) for (const c of [1,3,5]) put(r,c,'',valueStyle);
  for (const r of [9,12,18,21]) for (let c = 0; c < 6; c += 1) put(r,c,cellData[String(r)]![String(c)]!.v,headerStyle);
  for (const regionRow of [10,13,19,22]) for (let c = 0; c < 6; c += 1) put(regionRow,c,'', { ...valueStyle, ...(c === 4 ? { ht: 3 } : {}) });
  const merges = [1,5,8,11,14,17,20].map((r) => ({ startRow: r, startColumn: 0, endRow: r, endColumn: 5 }));
  merges.push({ startRow: 0, startColumn: 0, endRow: 0, endColumn: 5 });
  const workbook = { id: 'moheng-project-studio', name: '项目综合经营报告', appVersion: '1.0.4', locale: 'zhCN', styles: {}, sheetOrder: ['sheet1'], sheets: { sheet1: { id: 'sheet1', name: '项目综合报告', rowCount: 80, columnCount: 12, defaultColumnWidth: 100, defaultRowHeight: 24, mergeData: merges, cellData, rowData: { '0': { h: 34 }, '1': { h: 28 }, '5': { h: 28 }, '8': { h: 26 }, '11': { h: 26 }, '14': { h: 26 }, '17': { h: 26 }, '20': { h: 26 } }, columnData: { '0': { w: 140 }, '1': { w: 135 }, '2': { w: 140 }, '3': { w: 125 }, '4': { w: 140 }, '5': { w: 130 } }, showGridlines: 1, freeze: { startRow: -1, startColumn: -1, ySplit: 3, xSplit: 0 } } } };
  const bindings: ReportStudioBinding[] = [
    ['B3','project','name'], ['D3','project','code'], ['F3','project','ownerName'],
    ['B4','financialSummary','effectiveContractAmount'], ['D4','financialSummary','netReceipts'], ['F4','financialSummary','issuedReceivableNetAmount'],
    ['B5','financialSummary','downstreamNetPaymentTotal'], ['D5','financialSummary','downstreamRefundTotal'], ['F5','financialSummary','postedPayableTotal'],
    ['B7','mainContract','contractNo'], ['D7','mainContract','name'], ['F7','mainContract','amount'],
    ['B16','financialSummary','targetCostTotal'], ['D16','financialSummary','actualCostTotal'], ['F16','financialSummary','postedPayableTotal'],
  ].map(([cellAddress, sourceId, fieldId], index) => ({ id: `binding-${index + 1}`, sheetId: 'sheet1', cell: cellAddress!, sourceId: sourceId!, fieldId: fieldId!, format: /amount|receipts|total/i.test(fieldId!) ? 'MONEY' as const : 'AUTO' as const }));
  const regionBindingSet: Array<[number, string, string[]]> = [
    [10, 'downstreamContracts', ['contractNo','name','counterpartyName','status','effectiveAmount','signedAt']],
    [13, 'ownerReceipts', ['receiptNo','type','amount','receivedAt','referenceNo','notes']],
    [19, 'changes', ['code','name','type','externalStatus','confirmedAmount','effectiveAt']],
    [22, 'downstreamPayments', ['contractNo','type','amount','paidAt','referenceNo','originalReferenceNo']],
  ];
  const regions: ReportStudioRegion[] = regionBindingSet.map(([templateRow, sourceId], index) => ({ id: `region-${index+1}`, sheetId: 'sheet1', sourceId, templateRow, startColumn: 0, endColumn: 5, maxRows: 10000 }));
  for (const [row, sourceId, fields] of regionBindingSet) fields.forEach((fieldId, c) => bindings.push({ id: `binding-region-${row}-${c}`, sheetId: 'sheet1', cell: `${String.fromCharCode(65 + c)}${row + 1}`, sourceId, fieldId, format: defaultRegionFieldFormat(fieldId, /Amount|amount/i.test(fieldId)) }));
  addBindingPlaceholders(workbook, bindings);
  return { workbook, bindings, regions };
}
function defaultCompanyData() {
  const cellData = rowsFrom([
    ['公司经营汇总报告'], ['公司核心指标'], ['可访问项目数', '', '当前有效合同额合计', '', '累计登记净收款', ''], ['登记净应收合计', '', '已录入实际成本合计', '', '分供合同当前金额合计', ''], ['累计分供净支付', '', '累计分供退款', '', '已登记净应付合计', ''], ['项目经营情况'], ['项目编号', '项目名称', '项目状态', '项目负责人', '当前有效合同额', '累计登记净收款', '登记净应收', '实际成本'], [''], [''], ['分供合同清单'], ['项目编号', '项目名称', '合同编号', '合同名称', '合同类别', '往来单位', '合同状态', '签订日期', '原始合同额', '当前有效合同额'], [''], [''], ['业主收款与退款流水'], ['项目编号', '项目名称', '流水编号', '类型', '金额', '到账日期', '参考号', '原始收款编号'], [''], [''], ['分供合同付款与退款流水'], ['项目编号', '项目名称', '分供合同编号', '类型', '支付/退款金额', '支付日期', '支付参考号', '原付款参考号'], [''],
  ]);
  const put = (r: number, c: number, v: unknown, s?: Record<string, unknown>) => { (cellData[String(r)] ??= {})[String(c)] = cell(v, s); };
  put(0,0,'公司经营汇总报告',titleStyle); put(1,0,'公司核心指标',sectionStyle); put(5,0,'项目经营情况',sectionStyle); put(9,0,'分供合同清单',sectionStyle); put(13,0,'业主收款与退款流水',sectionStyle); put(17,0,'分供合同付款与退款流水',sectionStyle);
  for (const r of [2,3,4]) for (const c of [0,2,4]) put(r,c,cellData[String(r)]![String(c)]!.v,labelStyle);
  for (const r of [2,3,4]) for (const c of [1,3,5]) put(r,c,'',valueStyle);
  for (let c=0;c<8;c+=1) put(6,c,cellData['6']![String(c)]!.v,headerStyle);
  for (let c=0;c<8;c+=1) put(7,c,'',valueStyle);
  for (let c=0;c<10;c+=1) put(10,c,cellData['10']![String(c)]!.v,headerStyle);
  for (let c=0;c<10;c+=1) put(11,c,'',valueStyle);
  for (let c=0;c<8;c+=1) put(14,c,cellData['14']![String(c)]!.v,headerStyle);
  for (let c=0;c<8;c+=1) put(15,c,'',valueStyle);
  for (let c=0;c<8;c+=1) put(18,c,cellData['18']![String(c)]!.v,headerStyle);
  for (let c=0;c<8;c+=1) put(19,c,'',valueStyle);
  const workbook = { id: 'moheng-company-studio', name: '公司经营汇总报告', appVersion: '1.0.4', locale: 'zhCN', styles: {}, sheetOrder: ['sheet1'], sheets: { sheet1: { id:'sheet1', name:'公司经营汇总', rowCount:80, columnCount:12, defaultColumnWidth:110, defaultRowHeight:24, mergeData:[{startRow:0,startColumn:0,endRow:0,endColumn:9},{startRow:1,startColumn:0,endRow:1,endColumn:9},{startRow:5,startColumn:0,endRow:5,endColumn:7},{startRow:9,startColumn:0,endRow:9,endColumn:9},{startRow:13,startColumn:0,endRow:13,endColumn:7},{startRow:17,startColumn:0,endRow:17,endColumn:7}], cellData, rowData:{'0':{h:34},'1':{h:28},'5':{h:28},'9':{h:28},'13':{h:28},'17':{h:28}}, columnData:{'0':{w:120},'1':{w:170},'2':{w:100},'3':{w:120},'4':{w:145},'5':{w:145},'6':{w:140},'7':{w:140},'8':{w:145},'9':{w:145}}, showGridlines:1, freeze:{startRow:-1,startColumn:-1,ySplit:7,xSplit:0} } } };
  const bindings: ReportStudioBinding[] = [
    ['B3','companySummary','projectCount','NUMBER'], ['D3','companySummary','effectiveContractAmount','MONEY'], ['F3','companySummary','netReceipts','MONEY'],
    ['B4','companySummary','issuedReceivableNetAmount','MONEY'], ['D4','companySummary','actualCostTotal','MONEY'], ['F4','companySummary','downstreamContractTotal','MONEY'],
    ['B5','companySummary','downstreamNetPaymentTotal','MONEY'], ['D5','companySummary','downstreamRefundTotal','MONEY'], ['F5','companySummary','postedPayableTotal','MONEY'],
  ].map(([cellAddress, sourceId, fieldId, format], index) => ({ id:`binding-${index+1}`, sheetId:'sheet1', cell:cellAddress!, sourceId:sourceId!, fieldId:fieldId!, format:format as ReportStudioBinding['format'] }));
  const fields = ['code','name','status','managerName','effectiveContractAmount','netReceipts','issuedReceivableNetAmount','actualCostTotal'];
  const regions: ReportStudioRegion[] = [
    { id:'company-projects', sheetId:'sheet1', sourceId:'companyProjects', templateRow:7, startColumn:0, endColumn:7, maxRows:10000 },
    { id:'company-downstream-contracts', sheetId:'sheet1', sourceId:'companyDownstreamContracts', templateRow:11, startColumn:0, endColumn:9, maxRows:10000 },
    { id:'company-owner-receipts', sheetId:'sheet1', sourceId:'companyOwnerReceipts', templateRow:15, startColumn:0, endColumn:7, maxRows:10000 },
    { id:'company-downstream-payments', sheetId:'sheet1', sourceId:'companyDownstreamPayments', templateRow:19, startColumn:0, endColumn:7, maxRows:10000 },
  ];
  fields.forEach((fieldId,c) => bindings.push({id:`project-row-${c}`,sheetId:'sheet1',cell:`${String.fromCharCode(65+c)}8`,sourceId:'companyProjects',fieldId,format:/Amount|Receipts|Cost/i.test(fieldId)?'MONEY':'AUTO'}));
  const contractFields = ['projectCode','projectName','contractNo','name','type','counterpartyName','status','signedAt','originalAmount','effectiveAmount'];
  contractFields.forEach((fieldId,c) => bindings.push({id:`company-downstream-contract-${c}`,sheetId:'sheet1',cell:`${String.fromCharCode(65+c)}12`,sourceId:'companyDownstreamContracts',fieldId,format:defaultRegionFieldFormat(fieldId, ['originalAmount','effectiveAmount'].includes(fieldId))}));
  const ownerReceiptFields = ['projectCode','projectName','receiptNo','type','amount','receivedAt','referenceNo','originalReceiptNo'];
  ownerReceiptFields.forEach((fieldId,c) => bindings.push({id:`company-owner-receipt-${c}`,sheetId:'sheet1',cell:`${String.fromCharCode(65+c)}16`,sourceId:'companyOwnerReceipts',fieldId,format:defaultRegionFieldFormat(fieldId, fieldId === 'amount')}));
  const paymentFields = ['projectCode','projectName','contractNo','type','amount','paidAt','referenceNo','originalReferenceNo'];
  paymentFields.forEach((fieldId,c) => bindings.push({id:`company-downstream-payment-${c}`,sheetId:'sheet1',cell:`${String.fromCharCode(65+c)}20`,sourceId:'companyDownstreamPayments',fieldId,format:defaultRegionFieldFormat(fieldId, fieldId === 'amount')}));
  addBindingPlaceholders(workbook, bindings);
  return { workbook, bindings, regions };
}


function defaultPartyData() {
  const rows = [
    ['往来单位经营档案报告'],
    ['单位基础资料'],
    ['单位名称', '', '统一社会信用代码', '', '业务角色', '', '档案状态', ''],
    ['主体核验状态', '', '历史名称', '', '最近更新日期', '', '系统档案 ID', ''],
    ['联系人', '', '联系电话', '', '电子邮箱', '', '纳税人识别号', ''],
    ['地址', '', '法定代表人', '', '发票抬头', '', '备注', ''],
    ['经营指标概览'],
    ['关联项目数', '', '业主主合同数', '', '分供合同数', '', '主合同当前有效金额', ''],
    ['业主已回款', '', '分供合同当前金额', '', '分供累计结算', '', '分供累计净付款', ''],
    ['分供应付未付', '', '待返还/抵扣', '', '合同关联实际成本', '', '独立关联实际成本', ''],
    ['关联项目清单'],
    ['项目编号', '项目名称', '项目状态', '关联角色', '主合同当前金额', '分供合同当前金额', '业主已回款', '分供净付款'],
    [''],
    ['关联业主主合同'],
    ['项目编号', '项目名称', '合同编号', '合同名称', '项目状态', '原始合同金额', '当前有效合同额', '已回款'],
    [''],
    ['关联分供合同、结算与应付'],
    ['项目编号', '项目名称', '合同编号', '合同名称', '类别', '状态', '当前合同额', '累计结算'],
    [''],
    ['单独关联成本记录（最近 200 条）'],
    ['项目编号', '项目名称', '成本日期', '费用说明', '成本类型', '成本金额', '业务对象', ''],
    [''],
  ];
  const cellData = rowsFrom(rows);
  const put = (r: number, c: number, v: unknown, style?: Record<string, unknown>) => { (cellData[String(r)] ??= {})[String(c)] = cell(v, style); };
  put(0, 0, rows[0]![0], titleStyle);
  for (const r of [1, 6, 10, 13, 16, 19]) put(r, 0, rows[r]![0], sectionStyle);
  for (const r of [2,3,4,5,7,8,9]) {
    for (let c=0;c<8;c+=2) if (rows[r]![c]) put(r,c,rows[r]![c],labelStyle);
    for (let c=1;c<8;c+=2) put(r,c,'',valueStyle);
  }
  for (const [r, columns] of [[11,8],[14,8],[17,8],[20,8]] as Array<[number,number]>) {
    for (let c=0;c<columns;c+=1) put(r,c,rows[r]![c] ?? '',headerStyle);
  }
  for (const r of [12,15,18,21]) for (let c=0;c<8;c+=1) put(r,c,'',valueStyle);
  const merges = [0,1,6,10,13,16,19].map((r) => ({ startRow:r,startColumn:0,endRow:r,endColumn:7 }));
  const workbook = { id:'moheng-party-studio', name:'往来单位经营档案报告', appVersion:'1.0.4', locale:'zhCN', styles:{}, sheetOrder:['sheet1'], sheets:{ sheet1:{ id:'sheet1',name:'单位经营档案',rowCount:200,columnCount:8,defaultColumnWidth:120,defaultRowHeight:23,mergeData:merges,cellData,rowData:{'0':{h:36},'1':{h:28},'6':{h:28},'10':{h:28},'13':{h:28},'16':{h:28},'19':{h:28}},columnData:{'0':{w:115},'1':{w:145},'2':{w:125},'3':{w:145},'4':{w:125},'5':{w:145},'6':{w:125},'7':{w:145}},showGridlines:1,freeze:{startRow:-1,startColumn:-1,ySplit:2,xSplit:0} } } };
  const bindings: ReportStudioBinding[] = [
    ['B3','businessParty','name','TEXT'],['D3','businessParty','creditCode','TEXT'],['F3','businessParty','roles','TEXT'],['H3','businessParty','status','TEXT'],
    ['B4','businessParty','identityVerified','TEXT'],['D4','businessParty','formerNames','TEXT'],['F4','businessParty','updatedAt','DATE'],['H4','businessParty','id','TEXT'],
    ['B5','businessParty','contactName','TEXT'],['D5','businessParty','phone','TEXT'],['F5','businessParty','email','TEXT'],['H5','businessParty','taxNo','TEXT'],
    ['B6','businessParty','address','TEXT'],['D6','businessParty','legalRepresentative','TEXT'],['F6','businessParty','invoiceTitle','TEXT'],['H6','businessParty','notes','TEXT'],
    ['B8','partySummary','projectCount','NUMBER'],['D8','partySummary','mainContractCount','NUMBER'],['F8','partySummary','downstreamContractCount','NUMBER'],['H8','partySummary','ownerCurrentContractAmount','MONEY'],
    ['B9','partySummary','ownerReceivedAmount','MONEY'],['D9','partySummary','downstreamCurrentContractAmount','MONEY'],['F9','partySummary','downstreamSettledAmount','MONEY'],['H9','partySummary','downstreamPaidAmount','MONEY'],
    ['B10','partySummary','downstreamOpenPayableAmount','MONEY'],['D10','partySummary','downstreamSupplierCreditAmount','MONEY'],['F10','partySummary','downstreamActualCostAmount','MONEY'],['H10','partySummary','standaloneCostAmount','MONEY'],
  ].map(([cellAddress,sourceId,fieldId,format],index)=>({id:`party-binding-${index+1}`,sheetId:'sheet1',cell:cellAddress!,sourceId:sourceId!,fieldId:fieldId!,format:format as ReportStudioBinding['format']}));
  const regionSets: Array<[number,string,string[]]> = [
    [12,'partyProjects',['code','name','status','role','incomeContractAmount','downstreamContractAmount','incomePaidAmount','downstreamPaidAmount']],
    [15,'partyMainContracts',['projectCode','projectName','contractNo','name','status','originalAmount','currentAmount','paidAmount']],
    [18,'partyDownstreamContracts',['projectCode','projectName','contractNo','name','type','status','currentAmount','settledAmount']],
    [21,'partyStandaloneCosts',['projectCode','projectName','date','description','type','amount','vendorName']],
  ];
  const regions: ReportStudioRegion[] = regionSets.map(([templateRow,sourceId,fields],index)=>({id:`party-region-${index+1}`,sheetId:'sheet1',sourceId,templateRow,startColumn:0,endColumn:fields.length-1,maxRows:10000}));
  for (const [row,sourceId,fields] of regionSets) fields.forEach((fieldId,c)=>bindings.push({id:`party-region-binding-${row}-${c}`,sheetId:'sheet1',cell:`${String.fromCharCode(65+c)}${row+1}`,sourceId,fieldId,format:defaultRegionFieldFormat(fieldId, /Amount|amount|Paid|paid|Payable|settled|Cost/i.test(fieldId))}));
  addBindingPlaceholders(workbook,bindings);
  return {workbook,bindings,regions};
}

export function createDefaultStudioDefinition(domain: ReportStudioDomain): ReportStudioDefinition {
  const result = domain === 'PROJECT' ? defaultProjectData() : domain === 'PARTY' ? defaultPartyData() : defaultCompanyData();
  return { schemaVersion:2, domain, title: domain === 'PROJECT' ? '项目综合经营报告' : domain === 'PARTY' ? '往来单位经营档案报告' : '公司经营汇总报告', description:'由墨衡报表工作室创建。数据按当前账号有权访问的项目和业务关系读取。', workbook: result.workbook, bindings: result.bindings, regions: result.regions, page:{paper:'A4',orientation:'landscape',fitToWidth:true,includeMetadata:true,footerText:'墨衡工程经营管理系统'} };
}
