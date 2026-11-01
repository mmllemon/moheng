import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Upload, X } from 'lucide-react';
import { api } from '../api';
import { Button } from './Ui';

type Inspection = { sheetName: string; headers: string[]; rows: string[][]; rowCount: number; maxRows: number };
type PreviewRow = {
  rowNumber: number;
  valid: boolean;
  errors: string[];
  data?: { date: string; type: string; description: string; amount: number; taxRate?: number | null; taxAmount?: number | null; contractNo: string | null; budgetItemCode: string | null; partyName: string | null };
};
type PreviewResult = {
  rows: PreviewRow[];
  total: number;
  validCount: number;
  invalidCount: number;
  unknownColumns: string[];
  canImport: boolean;
};

const TYPE_LABELS: Record<string, string> = {
  LABOR: '人工', MATERIAL: '材料', MACHINE: '机械', SUBCONTRACT: '分包', INDIRECT: '间接费用',
};

async function fileToBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : '';
}

/**
 * 实际成本批量导入对话框。
 *
 * 与目标成本清单走同一条链路：下载模板 → 上传检视 → 服务端预检 → 整批提交。
 * v1 不做手工列映射：表头按固定中文名匹配（见 apps/api/src/lib/cost-import.ts 的别名表），
 * 匹配不上会直接报缺哪几列，比让人一列一列选更快。
 */
export default function CostImportDialog({ projectId, onClose, onImported }: {
  projectId: string;
  onClose: () => void;
  onImported: (count: number) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sheet, setSheet] = useState<Inspection | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  const downloadTemplate = async () => {
    setError('');
    try {
      const blob = await api.download(`/projects/${projectId}/costs/import-template.xlsx`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = '墨衡-实际成本导入模板.xlsx';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setNotice('已下载模板。按“填报说明”填写后选择该文件即可预览。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '模板下载失败');
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setError(''); setNotice(''); setPreview(null); setSheet(null);
    try {
      const base64 = await fileToBase64(file);
      const inspected = await api.post<Inspection>(`/projects/${projectId}/costs/import-xlsx/inspect`, { filename: file.name, base64 });
      setSheet(inspected);
      const result = await api.post<PreviewResult>(`/projects/${projectId}/costs/import/preview`, { headers: inspected.headers, rows: inspected.rows });
      setPreview(result);
      if (result.invalidCount > 0) setNotice(`共 ${result.total} 行，其中 ${result.invalidCount} 行需要修正后再导入。`);
      else setNotice(`共 ${result.total} 行，全部通过校验，可以导入。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '文件解析失败');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const commit = async () => {
    if (!sheet || !preview) return;
    setBusy(true); setError('');
    try {
      const result = await api.post<{ imported: number }>(`/projects/${projectId}/costs/import`, { headers: sheet.headers, rows: sheet.rows });
      onImported(result.imported);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败');
    } finally {
      setBusy(false);
    }
  };

  const invalidRows = preview?.rows.filter((row) => !row.valid) ?? [];

  return createPortal(<div className="modal-backdrop">
    <div className="dialog import-dialog cost-import-dialog" role="dialog" aria-modal="true" aria-label="导入实际成本">
      <div className="dialog-header">
        <div><h2>导入实际成本</h2><p>上传 .xlsx 模板，校验通过后整批写入；任何一行有问题都整批不导入。</p></div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭导入对话框"><X size={18} /></Button>
      </div>
      <div className="dialog-body">
        <div className="import-steps">
          <Button variant="secondary" onClick={() => void downloadTemplate()} disabled={busy}>下载导入模板</Button>
          <Button onClick={() => fileRef.current?.click()} disabled={busy}><Upload size={15} />选择文件</Button>
          <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(event) => void handleFile(event.target.files?.[0])} />
          {sheet && <span className="import-meta">{sheet.sheetName} · {sheet.rowCount} 行（上限 {sheet.maxRows}）</span>}
        </div>

        {notice && <div className="inline-notice">{notice}</div>}
        {error && <div className="form-alert">{error}</div>}
        {preview?.unknownColumns.length ? <div className="inline-notice">以下表头未被识别，已忽略：{preview.unknownColumns.join('、')}</div> : null}

        {preview && <div className="import-preview-wrap">
          <table className="data-table">
            <thead><tr><th>行号</th><th>日期</th><th>类型</th><th>费用说明</th><th className="align-right">金额(元)</th><th className="align-right">税率</th><th>关联</th><th>校验</th></tr></thead>
            <tbody>{preview.rows.slice(0, 200).map((row) => <tr className={row.valid ? '' : 'import-row-error'} key={row.rowNumber}>
              <td>{row.rowNumber}</td>
              <td>{row.data?.date ?? '—'}</td>
              <td>{row.data ? TYPE_LABELS[row.data.type] ?? row.data.type : '—'}</td>
              <td>{row.data?.description ?? '—'}</td>
              <td className="align-right">{row.data ? row.data.amount.toFixed(2) : '—'}</td>
              <td className="align-right">{row.data?.taxRate != null ? `${row.data.taxRate}%` : '—'}</td>
              <td>{[row.data?.contractNo, row.data?.budgetItemCode, row.data?.partyName].filter(Boolean).join(' / ') || '—'}</td>
              <td>{row.valid ? '通过' : row.errors.join('；')}</td>
            </tr>)}</tbody>
          </table>
          {preview.rows.length > 200 && <p className="import-meta">仅显示前 200 行，导入时按全部 {preview.total} 行处理。</p>}
        </div>}

        {invalidRows.length > 0 && <p className="import-meta">有 {invalidRows.length} 行未通过：请修正后重新选择文件。整批导入不会写入部分数据。</p>}
      </div>
      <div className="dialog-footer">
        <Button variant="ghost" onClick={onClose} disabled={busy}>取消</Button>
        <Button onClick={() => void commit()} disabled={busy || !preview?.canImport}>{busy ? '处理中…' : preview?.canImport ? `导入 ${preview.validCount} 行` : '修正后重新上传'}</Button>
      </div>
    </div>
  </div>, document.body);
}
