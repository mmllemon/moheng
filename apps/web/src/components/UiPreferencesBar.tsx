import { Palette } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { rememberPaperOrigin } from '../lib/paper-morph';

export default function UiPreferencesBar({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate();
  return <button
    type="button"
    className="titlebar-icon"
    aria-label="打开界面设置"
    data-tooltip="界面、纸纹与显示" data-tooltip-align="end"
    onClick={(event) => { rememberPaperOrigin(event.currentTarget); navigate('/settings/appearance'); }}
  ><Palette size={16} strokeWidth={1.65} /><span className="sr-only">{compact ? '界面设置' : '界面与显示设置'}</span></button>;
}
