import { Banknote, FileCheck2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import DownstreamContractsPage from './DownstreamContractsPage';
import DownstreamFinancePage from './DownstreamFinancePage';

export default function DownstreamWorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view') === 'finance' ? 'finance' : 'contracts';
  function switchView(next: 'contracts' | 'finance') {
    setSearchParams(next === 'finance' ? { view: 'finance' } : {}, { replace: false });
  }
  return <div className="downstream-workspace-page">
    <div className="downstream-module-switch" role="tablist" aria-label="分供合同与财务">
      <button role="tab" aria-selected={view === 'contracts'} className={view === 'contracts' ? 'active' : ''} onClick={() => switchView('contracts')}><Banknote size={16} />合同台账与付款</button>
      <span className="downstream-module-divider" aria-hidden="true" />
      <button role="tab" aria-selected={view === 'finance'} className={view === 'finance' ? 'active' : ''} onClick={() => switchView('finance')}><FileCheck2 size={16} />结算与应付账款</button>
    </div>
    {view === 'contracts' ? <DownstreamContractsPage /> : <DownstreamFinancePage />}
  </div>;
}
