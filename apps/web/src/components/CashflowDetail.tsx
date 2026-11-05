/**
 * 资金计划月份下钻的共享视图。
 *
 * 项目级（成本分析）和公司级（经营总览）用的是同一套明细结构，差别只在
 * 公司级多一层“这笔钱属于哪个项目”。两处各写一遍表格既容易走样，也容易
 * 让一边的合计口径悄悄漂移，所以合到一个组件里。
 *
 * 这里不做任何金额计算：合计由后端按同一套分桶函数给出，明细行只负责展示。
 */
import { Fragment } from 'react';
import { formatMoney } from './Ui';
import { isZeroMoney, moneySign } from '../lib/money';
import type { CashflowBucketDetail, CashflowDetailItem } from '../types';

const SOURCE_LABEL: Record<CashflowDetailItem['source'], string> = {
  RECEIVABLE: '应收',
  PAYABLE: '应付',
  PLAN: '付款计划',
  INVOICE_TAX: '销项税',
};

export type CashflowDetailGroup = {
  key: string;
  /** 公司级填项目名；项目级留空，表头只显示月份。 */
  name: string;
  code?: string;
  detail: CashflowBucketDetail;
};

const dateText = (iso: string | null) => (iso ? iso.slice(0, 10) : '未约定');

export function CashflowDetail({ title, subtitle, groups, loading, error, onRetry, onClose }: {
  title: string;
  subtitle?: string;
  groups: CashflowDetailGroup[];
  loading: boolean;
  error: Error | null;
  onRetry?: () => void;
  onClose: () => void;
}) {
  const showProject = groups.some((group) => group.name.length > 0);
  return <div className="cf-detail">
    <div className="cf-detail-head">
      <div><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</div>
      <button type="button" className="cf-detail-close" onClick={onClose}>收起</button>
    </div>
    {loading && <p className="cf-detail-state">正在读取明细…</p>}
    {!loading && error && <p className="cf-detail-state">
      明细读取失败：{error.message}
      {onRetry && <button type="button" className="cf-detail-retry" onClick={onRetry}>重试</button>}
    </p>}
    {!loading && !error && groups.length === 0 && <p className="cf-detail-state">这个月没有带到期日的金额。</p>}
    {!loading && !error && groups.length > 0 && <div className="table-scroll">
      <table className="data-table v6-table cf-detail-table">
        <thead><tr>
          {showProject && <th>项目</th>}
          <th>内容</th>
          <th>依据</th>
          <th>类型</th>
          <th>到期日</th>
          <th className="align-right">金额</th>
        </tr></thead>
        <tbody>
          {groups.map((group) => <Fragment key={group.key}>
            {showProject && <tr className="cf-detail-group">
              <td>{group.name}</td>
              <td colSpan={4} className="cf-detail-group-total">
                {group.detail.items.length} 笔 · 应收 {formatMoney(group.detail.inflow, 0)} / 应付 {formatMoney(group.detail.outflow, 0)}
              </td>
              <td className="align-right numeric"><strong>{isZeroMoney(group.detail.net) ? '—' : `${moneySign(group.detail.net) > 0 ? '+' : '−'}${formatMoney(Math.abs(group.detail.net), 0)}`}</strong></td>
            </tr>}
            {group.detail.items.map((item, index) => <tr key={`${item.source}-${item.ref?.id ?? index}-${item.dueAt ?? 'none'}-${index}`}>
              {showProject && <td />}
              <td><strong className="table-primary-text">{item.ref?.title ?? SOURCE_LABEL[item.source]}</strong></td>
              <td className="cf-detail-basis">{item.ref?.sub ?? '—'}</td>
              <td className="cf-detail-kind">{SOURCE_LABEL[item.source]}</td>
              <td className="numeric">{dateText(item.dueAt)}</td>
              <td className={`align-right numeric ${item.direction === 'INFLOW' ? '' : 'cf-detail-out'}`}>{item.direction === 'INFLOW' ? '' : '−'}{formatMoney(item.amount, 2)}</td>
            </tr>)}
          </Fragment>)}
        </tbody>
      </table>
    </div>}
  </div>;
}
