import { useNavigate } from 'react-router-dom';
import { Eye, FileSpreadsheet, Settings2 } from 'lucide-react';
import { useUiStore } from '../auth-store';
import { Button } from './Ui';

export type StandardReportKey =
  | 'target-cost'
  | 'actual-cost'
  | 'progress-bills'
  | 'changes'
  | 'owner-receivables'
  | 'owner-receipts'
  | 'downstream-contracts'
  | 'downstream-payables';

/** Opens the same preview/export workflow used by the report center, scoped to the active project. */
export function ProjectLedgerReportButton({ reportKey, label = '预览 / 导出报表' }: { reportKey: StandardReportKey; label?: string }) {
  const navigate = useNavigate();
  const projectId = useUiStore((state) => state.selectedProjectId);
  return <Button variant="secondary" size="sm" disabled={!projectId} onClick={() => {
    if (!projectId) return;
    const params = new URLSearchParams({ reportKey, projectId, source: 'workspace' });
    navigate(`/reports/preview?${params.toString()}`);
  }}><Eye size={14} />{label}</Button>;
}

/** Creates a default personal project report template if needed, then opens its real-data preview. */
export function ProjectSummaryReportButton({ label = '预览 / 导出项目综合报表' }: { label?: string }) {
  const navigate = useNavigate();
  const projectId = useUiStore((state) => state.selectedProjectId);
  return <Button variant="secondary" size="sm" disabled={!projectId} onClick={() => {
    if (!projectId) return;
    const params = new URLSearchParams({ domain: 'PROJECT', projectId, autoPreview: '1' });
    navigate(`/reports/studio?${params.toString()}`);
  }}><FileSpreadsheet size={14} />{label}</Button>;
}

/** Uses the built-in business-party operating-profile template in the report studio. */
export function BusinessPartyReportButton({ partyId, label = '预览 / 导出经营档案' }: { partyId: string; label?: string }) {
  const navigate = useNavigate();
  return <Button variant="secondary" size="sm" disabled={!partyId} onClick={() => {
    if (!partyId) return;
    const params = new URLSearchParams({ domain: 'PARTY', partyId, autoPreview: '1' });
    navigate(`/reports/studio?${params.toString()}`);
  }}><FileSpreadsheet size={14} />{label}</Button>;
}

/** Opens the unit-bound saved template in the editor rather than creating a second default template. */
export function BusinessPartyTemplateButton({ partyId, label = '编辑报表模板' }: { partyId: string; label?: string }) {
  const navigate = useNavigate();
  return <Button variant="secondary" size="sm" disabled={!partyId} onClick={() => {
    if (!partyId) return;
    const params = new URLSearchParams({ domain: 'PARTY', partyId, openSavedTemplate: '1' });
    navigate(`/reports/studio?${params.toString()}`);
  }}><Settings2 size={14} />{label}</Button>;
}
