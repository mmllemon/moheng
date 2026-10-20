import { useSearchParams } from 'react-router-dom';
import DownstreamContractsPage from './DownstreamContractsPage';
import DownstreamFinancePage from './DownstreamFinancePage';

export default function DownstreamWorkspacePage() {
  const [searchParams] = useSearchParams();
  const view = searchParams.get('view') === 'finance' ? 'finance' : 'contracts';
  return view === 'contracts' ? <DownstreamContractsPage /> : <DownstreamFinancePage />;
}
