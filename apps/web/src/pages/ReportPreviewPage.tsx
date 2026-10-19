import { useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Printer, RefreshCw } from 'lucide-react';
import type { CSSProperties } from 'react';
import { api } from '../api';
import { useUiStore } from '../auth-store';
import { Button, ErrorBlock, LoadingBlock, PageHeader } from '../components/Ui';
import type { ReportPreview } from '../report-template-types';
import type { ReportStudioPreview, ReportStudioTemplate } from '../report-studio-types';
import { roundFixedDecimal } from '../report-preview-format';
import { classifyReportExportJob } from '../report-export-job.js';

function colorValue(input: unknown): string | undefined {
  if (typeof input !== 'string') {
    if (input && typeof input === 'object' && 'rgb' in input) return colorValue((input as { rgb?: unknown }).rgb);
    return undefined;
  }
  const hex = input.replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex}`;
  if (/^[0-9a-f]{8}$/i.test(hex)) return `#${hex.slice(-6)}`;
  return undefined;
}
function styleBoolean(value: unknown) { return value === true || value === 1; }
function borderCssStyle(value: unknown): string {
  const key = String(value);
  const map: Record<string, string> = {
    '1': 'solid', '2': 'solid', '3': 'dotted', '4': 'dashed', '5': 'dashed', '6': 'dashed', '7': 'double',
    '8': 'solid', '9': 'dashed', '10': 'dashed', '11': 'dashed', '12': 'dashed', '13': 'solid',
    thin: 'solid', hair: 'solid', dotted: 'dotted', dashed: 'dashed', dashDot: 'dashed', dashDotDot: 'dashed', double: 'double', medium: 'solid', thick: 'solid',
  };
  return map[key] ?? 'solid';
}
function studioCellStyle(raw: Record<string, unknown> | null, format: string | null): CSSProperties {
  const style = raw ?? {};
  const result: CSSProperties = {};
  if (typeof style.ff === 'string') result.fontFamily = style.ff;
  if (typeof style.eastAsiaFontFamily === 'string') result.fontFamily = `${style.ff ? `${style.ff}, ` : ''}${style.eastAsiaFontFamily}`;
  // Univer font sizes are points; convert to CSS pixels for the closest on-screen match.
  if (typeof style.fs === 'number') result.fontSize = `${Math.max(6, Math.min(96, style.fs)) * 96 / 72}px`;
  if (styleBoolean(style.bl)) result.fontWeight = 700;
  if (styleBoolean(style.it)) result.fontStyle = 'italic';
  if (style.ul !== undefined && style.ul !== null && style.ul !== 0 && style.ul !== false) result.textDecoration = 'underline';
  if (styleBoolean(style.st)) result.textDecoration = `${result.textDecoration ? `${result.textDecoration} ` : ''}line-through`;
  if (styleBoolean(style.ol)) result.textDecoration = `${result.textDecoration ? `${result.textDecoration} ` : ''}overline`;
  const foreground = colorValue(style.cl);
  const background = colorValue(style.bg);
  if (foreground) result.color = foreground;
  if (background) result.backgroundColor = background;
  if (style.ht !== undefined) result.textAlign = ({ 1: 'left', 2: 'center', 3: 'right' } as Record<string, CSSProperties['textAlign']>)[String(style.ht)] ?? 'left';
  if (style.vt !== undefined) result.verticalAlign = ({ 1: 'top', 2: 'middle', 3: 'bottom' } as Record<string, CSSProperties['verticalAlign']>)[String(style.vt)] ?? 'middle';
  // Univer tb: 1=overflow, 2=truncate, 3=wrap. tr is text rotation.
  if (style.tb === 3) { result.whiteSpace = 'pre-wrap'; result.overflowWrap = 'anywhere'; }
  else if (style.tb === 2) { result.whiteSpace = 'nowrap'; result.overflow = 'hidden'; textOverflow(result); }
  if (typeof style.tr === 'number' && style.tr !== 0) result.writingMode = Math.abs(style.tr) > 45 ? 'vertical-rl' : 'horizontal-tb';
  const border = style.bd;
  if (border && typeof border === 'object') {
    const edges = border as Record<string, unknown>;
    const map: Array<[string, string]> = [['t','Top'],['b','Bottom'],['l','Left'],['r','Right']];
    for (const [key, suffix] of map) {
      const edge = edges[key];
      if (!edge || typeof edge !== 'object') continue;
      const edgeData = edge as Record<string, unknown>;
      const rawLine = edgeData.s ?? edgeData.style;
      const numericLine = Number(rawLine);
      if ((rawLine === undefined || rawLine === null || rawLine === 0) && !(edgeData.cl || edgeData.color)) continue;
      const color = colorValue(edgeData.cl ?? edgeData.color) ?? '#D7E0EA';
      const width = numericLine >= 13 ? 3 : numericLine >= 7 ? 2 : 1;
      (result as Record<string, unknown>)[`border${suffix}`] = `${width}px ${borderCssStyle(rawLine)} ${color}`;
    }
  }
  const pattern = style.n && typeof style.n === 'object' && !Array.isArray(style.n) ? (style.n as Record<string, unknown>).pattern : undefined;
  if (format === 'MONEY' && typeof result.textAlign === 'undefined') result.textAlign = 'right';
  if (typeof pattern === 'string' && pattern.includes('%')) result.textAlign ??= 'right';
  return result;
}
function textOverflow(result: CSSProperties) { result.textOverflow = 'ellipsis'; }
function groupFixedDecimal(value: string) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return value;
  const grouped = match[2]!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${match[1]}${grouped}${match[3] ? `.${match[3]}` : ''}`;
}
function displayValue(value: unknown, format?: string | null, rawStyle?: Record<string, unknown> | null) {
  if (value === null || value === undefined || value === '') return '';
  const style = rawStyle ?? {};
  const pattern = style.n && typeof style.n === 'object' && !Array.isArray(style.n) ? (style.n as Record<string, unknown>).pattern : undefined;
  // A user-selected cell number format overrides the data binding's default display format.
  if (typeof pattern === 'string' && pattern !== 'General' && pattern !== '@') {
    if (pattern.includes('%')) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        const decimals = pattern.split('.')[1]?.split('%')[0]?.replace(/[^0#]/g, '').length ?? 0;
        return `${(numeric * 100).toLocaleString('zh-CN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}%`;
      }
    }
    const numericPattern = pattern.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '');
    if (/[#0,]/.test(numericPattern) && !/[ymdhs]/i.test(numericPattern)) {
      const decimals = numericPattern.includes('.') ? (numericPattern.split('.')[1]?.split(';')[0]?.match(/[0#]+/)?.[0].length ?? 0) : 0;
      if (typeof value === 'number' && Number.isFinite(value)) return value.toLocaleString('zh-CN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
      if (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value)) {
        const rounded = roundFixedDecimal(value, decimals);
        if (rounded !== null) return groupFixedDecimal(rounded);
      }
    }
  }
  if (format === 'MONEY' && typeof value === 'number') return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (format === 'MONEY' && typeof value === 'string') return groupFixedDecimal(value);
  if (format === 'NUMBER' && typeof value === 'number') return value.toLocaleString('zh-CN', { maximumFractionDigits: 3 });
  if (format === 'DATE' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value);
}

export default function ReportPreviewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const selectedProjectId = useUiStore((state) => state.selectedProjectId);
  const studioTemplateId = searchParams.get('studioTemplateId') || '';
  const rawDomain = searchParams.get('domain');
  const domain = rawDomain === 'COMPANY' ? 'COMPANY' : rawDomain === 'PARTY' ? 'PARTY' : 'PROJECT';
  const partyId = searchParams.get('partyId') || '';
  const projectId = searchParams.get('allProjects') === '1' ? '' : (searchParams.get('projectId') || selectedProjectId || '');
  const reportKey = searchParams.get('reportKey') || '';
  const templateId = searchParams.get('templateId') || '';
  const from = searchParams.get('from') || '';
  const to = searchParams.get('to') || '';
  const queryReturnTo = searchParams.get('returnTo');
  const routeState = location.state && typeof location.state === 'object' ? location.state as { safeReportPreviewBack?: unknown; returnTo?: unknown } : null;
  const routeStateReturnTo = typeof routeState?.returnTo === 'string' ? routeState.returnTo : null;
  const safeReturnTo = [queryReturnTo, routeStateReturnTo].find((candidate): candidate is string => Boolean(candidate && candidate.startsWith('/') && !candidate.startsWith('//') && !candidate.includes('\\') && !/[\u0000-\u001f]/.test(candidate))) ?? '/reports';
  const [exportBusy, setExportBusy] = useState(false);
  const [jobId, setJobId] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const isStudio = Boolean(studioTemplateId);
  function goBack() {
    // In-app entry points mark that their previous history entry is the correct source.
    // Auto-preview replaces the intermediate autoPreview=1 studio entry, preventing a back-loop.
    if (routeState?.safeReportPreviewBack === true) navigate(-1);
    else navigate(safeReturnTo, { replace: true });
  }

  const studioTemplateQuery = useQuery({
    queryKey: ['report-studio-template-preview', studioTemplateId],
    queryFn: () => api.get<ReportStudioTemplate>(`/reports/studio/templates/${studioTemplateId}`),
    enabled: isStudio,
  });
  const studioPreviewQuery = useQuery({
    queryKey: ['report-studio-preview', studioTemplateId, domain, projectId, partyId],
    queryFn: () => api.post<ReportStudioPreview>('/reports/studio/preview', { templateId: studioTemplateId, ...(domain === 'PROJECT' ? { projectId } : {}), ...(domain === 'PARTY' ? { businessPartyId: partyId } : {}) }),
    enabled: isStudio && Boolean(studioTemplateQuery.data) && (domain === 'COMPANY' || (domain === 'PROJECT' ? Boolean(projectId) : Boolean(partyId))),
  });
  const standardPreviewQuery = useQuery({
    queryKey: ['report-export-preview', reportKey, projectId, from, to, templateId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (projectId) params.set('projectId', projectId);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (templateId) params.set('templateId', templateId);
      return api.get<ReportPreview>(`/reports/${encodeURIComponent(reportKey)}/preview?${params.toString()}`);
    }, enabled: !isStudio && Boolean(reportKey),
  });
  const studioPreview = studioPreviewQuery.data;
  const standardPreview = standardPreviewQuery.data;
  const errorQuery = isStudio ? studioTemplateQuery.error ?? studioPreviewQuery.error : standardPreviewQuery.error;
  const loading = isStudio ? studioTemplateQuery.isLoading || studioPreviewQuery.isLoading : standardPreviewQuery.isLoading;
  const title = isStudio ? studioPreview?.title ?? studioTemplateQuery.data?.name ?? '综合报表预览' : standardPreview?.template.name ?? standardPreview?.report.label ?? '报表预览';
  const missingProjectScope = isStudio && domain === 'PROJECT' && !projectId;
  const missingPartyScope = isStudio && domain === 'PARTY' && !partyId;

  async function downloadJob(fileJobId: string): Promise<boolean> {
    try {
      const job = await api.get<{ id: string; status: string; resultAvailable: boolean; downloadUrl: string | null; result: { suggestedFileName?: string } | null }>(`/reports/jobs/${fileJobId}`);
      if (classifyReportExportJob(job) !== 'downloadable') {
        setNotice(`任务状态：${job.status}。任务编号：${fileJobId}`);
        return false;
      }
      const blob = await api.download(`/reports/jobs/${fileJobId}/download`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url;
      anchor.download = job.result?.suggestedFileName ?? `墨衡-报表-${fileJobId}.xlsx`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1200);
      setNotice('文件已生成，下载已开始。');
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '查询报表任务失败。');
      return false;
    }
  }

  async function exportXlsx() {
    setExportBusy(true); setError(''); setNotice('');
    try {
      const submitted = isStudio
        ? await api.post<{ id: string }> (`/reports/studio/templates/${studioTemplateId}/xlsx/jobs`, { ...(domain === 'PROJECT' ? { projectId } : {}), ...(domain === 'PARTY' ? { businessPartyId: partyId } : {}) }, { 'Idempotency-Key': globalThis.crypto?.randomUUID?.() ?? `report-${Date.now()}` })
        : await api.post<{ id: string }>(`/reports/${encodeURIComponent(reportKey)}.xlsx/jobs`, { projectId: projectId || undefined, from: from || undefined, to: to || undefined, templateId: templateId || undefined }, { 'Idempotency-Key': globalThis.crypto?.randomUUID?.() ?? `report-${Date.now()}` });
      setJobId(submitted.id); setNotice(`已提交后台生成任务：${submitted.id}。页面会等待短时间，完成后自动下载；你也可以稍后查询任务。`);
      let downloaded = false;
      let terminalWithoutDownload = false;
      for (let attempt = 0; attempt < 90; attempt += 1) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 1000));
        const job = await api.get<{ status: string; resultAvailable: boolean; downloadUrl: string | null }>(`/reports/jobs/${submitted.id}`);
        const disposition = classifyReportExportJob(job);
        if (disposition === 'failed') throw new Error(`报表生成失败，任务编号 ${submitted.id}`);
        if (disposition === 'completed-unavailable') {
          setError('报表任务已完成，但导出文件不可用或已过期。请重新提交导出任务。');
          setNotice(`任务已结束但没有可下载文件。任务编号：${submitted.id}`);
          terminalWithoutDownload = true;
          break;
        }
        if (disposition === 'downloadable') {
          downloaded = await downloadJob(submitted.id);
          terminalWithoutDownload = !downloaded;
          break;
        }
      }
      if (!downloaded && !terminalWithoutDownload) setNotice(`报表仍在后台处理。任务编号：${submitted.id}，可稍后查询或下载。`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '提交报表导出失败。'); }
    finally { setExportBusy(false); }
  }

  const standardColumns = useMemo(() => {
    if (!standardPreview) return [];
    const visible = standardPreview.template.definition.columns.map((column, sourceIndex) => ({ column, sourceIndex })).filter(({ column }) => column.visible);
    return visible.map(({ column, sourceIndex }) => ({ column, sourceIndex }));
  }, [standardPreview]);

  if (!isStudio && !reportKey) return <div className="page-wrap"><ErrorBlock message="缺少报表类型或综合报表模板编号。请从报表中心重新进入预览。" retry={() => navigate('/reports')} /></div>;
  return <div className="page-wrap report-export-preview-page">
    <PageHeader eyebrow="REPORTS / PREVIEW" title="报表预览" subtitle="核对实际数据、模板版本、统计范围与输出样式后，再确认生成 XLSX。预览不会修改业务台账；导出任务执行时会重新读取业务数据，如数据随后变化，最终文件数值可能与当前预览不同。" actions={<><Button variant="secondary" onClick={goBack}><ArrowLeft size={15}/>返回</Button><Button variant="secondary" onClick={() => { void (isStudio ? studioPreviewQuery.refetch() : standardPreviewQuery.refetch()); }}><RefreshCw size={15}/>刷新预览</Button><Button variant="secondary" onClick={() => window.print()}><Printer size={15}/>打印 / PDF</Button><Button onClick={() => void exportXlsx()} disabled={exportBusy || loading || Boolean(errorQuery) || missingProjectScope || missingPartyScope}><Download size={15}/>{exportBusy ? '正在生成…' : '确认并导出 XLSX'}</Button></>} />
    {loading && <LoadingBlock label="正在按当前权限范围读取报表预览…" />}
    {missingProjectScope && <ErrorBlock message="项目级报表需要明确选择项目。请返回报表工作室选择项目后重新预览。" retry={() => navigate('/reports/studio?domain=PROJECT')} />}
    {missingPartyScope && <ErrorBlock message="单位档案级报表需要指定往来单位。请从具体的单位经营档案页面进入。" retry={() => navigate('/parties')} />}
    {errorQuery && <ErrorBlock message={String(errorQuery)} retry={() => { void (isStudio ? studioTemplateQuery.refetch() : standardPreviewQuery.refetch()); }} />}
    {notice && <div className="success-notice"><CheckCircle2 size={16}/>{notice}{jobId && <Button variant="secondary" size="sm" onClick={() => void downloadJob(jobId)}>查询任务 / 下载结果</Button>}</div>}{error && <div className="form-alert">{error}</div>}
    {!loading && !errorQuery && <>
      <section className="report-preview-meta panel">
        <div><span>报表名称</span><strong>{title}</strong></div>
        <div><span>报表范围</span><strong>{isStudio ? domain === 'PROJECT' ? `项目 · ${projectId || '未选择'}` : domain === 'PARTY' ? `往来单位 · ${partyId || '未选择'}` : '公司 · 当前账号可访问项目' : standardPreview?.projectScope ?? '—'}</strong></div>
        <div><span>模板版本</span><strong>{isStudio ? `v${studioTemplateQuery.data?.version ?? '—'}` : `v${standardPreview?.template.version ?? 1}`}</strong></div>
        <div><span>生成时间</span><strong>{isStudio ? studioPreview?.generatedAt ? new Date(studioPreview.generatedAt).toLocaleString('zh-CN') : '—' : standardPreview?.generatedAt ? new Date(standardPreview.generatedAt).toLocaleString('zh-CN') : '—'}</strong></div>
      </section>
      {isStudio && studioPreview && <section className="report-studio-output-stack">
        {studioPreview.warnings.length > 0 && <div className="report-preview-warning">{studioPreview.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
        {studioPreview.truncated && <div className="report-preview-warning">部分明细或工作表达到行数上限。请缩小范围后再导出完整报表。</div>}
        {studioPreview.sheets.map((sheet) => {
          const colCount = Math.max(1, ...sheet.rows.map((row) => row.length), ...Object.keys(sheet.columnWidths).map(Number).map((x) => x + 1));
          const mergeByStart = new Map(sheet.merges.map((merge) => [`${merge.startRow}:${merge.startColumn}`, merge]));
          const covered = new Set<string>();
          for (const merge of sheet.merges) for (let r=merge.startRow;r<=merge.endRow;r+=1) for(let c=merge.startColumn;c<=merge.endColumn;c+=1) if (r!==merge.startRow || c!==merge.startColumn) covered.add(`${r}:${c}`);
          return <article className="report-preview-sheet panel" key={sheet.id}>
            <div className="report-preview-sheet-head"><div><strong>{sheet.name}</strong><small>{sheet.previewRowCount.toLocaleString('zh-CN')} / {sheet.rowCount.toLocaleString('zh-CN')} 行</small></div>{sheet.truncated && <span className="report-preview-truncated">预览已截断</span>}</div>
            <div className="report-preview-workbook-scroll"><table className="report-studio-preview-grid" style={{ width: `${36 + Array.from({length:colCount}, (_, col) => Math.min(420, Math.max(56, sheet.columnWidths[col] ?? 140))).reduce((total, width) => total + width, 0)}px`, minWidth: `${36 + Array.from({length:colCount}, (_, col) => Math.min(420, Math.max(56, sheet.columnWidths[col] ?? 140))).reduce((total, width) => total + width, 0)}px` }}><colgroup>{<col key="row-number" style={{ width: '36px' }} />}{Array.from({length:colCount},(_,col)=><col key={col} style={{width:`${Math.min(420,Math.max(56,sheet.columnWidths[col] ?? 140))}px`}} />)}</colgroup><tbody>
              {sheet.rows.map((row,rowIndex)=><tr key={rowIndex} style={sheet.rowHeights[rowIndex] ? {height:sheet.rowHeights[rowIndex]} : undefined}><th className="report-studio-preview-row-number">{rowIndex+1}</th>{Array.from({length:colCount},(_,columnIndex)=>{
                const cellKey=`${rowIndex}:${columnIndex}`; if (covered.has(cellKey)) return null;
                const merged=mergeByStart.get(cellKey); const cell=row[columnIndex];
                return <td key={columnIndex} colSpan={merged ? merged.endColumn-merged.startColumn+1:1} rowSpan={merged ? merged.endRow-merged.startRow+1:1} style={studioCellStyle(cell?.style ?? null,cell?.format ?? null)}>{displayValue(cell?.value,cell?.format,cell?.style ?? null)}</td>;
              })}</tr>)}
            </tbody></table></div>
          </article>;
        })}
      </section>}
      {!isStudio && standardPreview && <section className="report-preview-standard-surface panel">
        <div className="report-preview-standard-title"><h2>{standardPreview.template.definition.title}</h2>{standardPreview.template.definition.subtitle && <p>{standardPreview.template.definition.subtitle.replaceAll('{project}',standardPreview.projectScope).replaceAll('{generatedAt}',new Date(standardPreview.generatedAt).toLocaleString('zh-CN')).replaceAll('{rowCount}',String(standardPreview.rowCount))}</p>}</div>
        <div className="report-preview-workbook-scroll"><table className="report-preview-table" style={{ width: 'max-content', minWidth: 0, tableLayout: 'fixed' }}><colgroup>{standardColumns.map(({ column }) => <col key={column.id} style={{ width: `${Math.max(6, Math.min(72, column.width))}ch` }} />)}</colgroup><thead>
          {standardPreview.template.definition.customRows.map((row,index)=><tr key={`custom-${row.id}`}><th colSpan={Math.max(1,standardColumns.length)}>{row.cells.filter((_,i)=>standardPreview.template.definition.columns[i]?.visible).join('　')}</th></tr>)}
          <tr>{standardColumns.map(({column})=><th key={column.id} style={{textAlign:column.align}}>{column.label}</th>)}</tr>
        </thead><tbody>{standardPreview.rows.map((row,index)=><tr key={index}>{standardColumns.map(({column,sourceIndex})=>{
          const field = standardPreview.fields[sourceIndex];
          const value = column.fieldKey ? row[sourceIndex] : column.staticValue;
          return <td key={column.id} style={{textAlign:column.align}}>{displayValue(value,column.format==='auto' ? field?.type?.toUpperCase() : column.format.toUpperCase())}</td>;
        })}</tr>)}{standardPreview.rows.length===0 && <tr><td colSpan={Math.max(1,standardColumns.length)} className="report-preview-empty">当前筛选范围没有可预览的数据。</td></tr>}</tbody></table></div>
        <div className="report-preview-standard-footer"><span>预览显示 {standardPreview.previewRowCount.toLocaleString('zh-CN')} / {standardPreview.rowCount.toLocaleString('zh-CN')} 条</span>{standardPreview.truncated && <strong>数据已截断，请调整范围</strong>}</div>
      </section>}
    </>}
  </div>;
}
