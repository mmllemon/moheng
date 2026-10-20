import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, FileText, Paperclip, Stamp } from 'lucide-react';
import { Button, PageHeader, formatMoney } from '../components/Ui';
import '../styles/v7-case-preview.css';

type Note = { id: number; author: string; role: string; date: string; text: string };

const initialNotes: Note[] = [
  { id: 1, author: '王工', role: '成本经办', date: '10/20 16:10', text: '主合同金额与业主确认函一致；本次变更需补外部确认后再计入有效合同额。' },
  { id: 2, author: '李工', role: '项目复核', date: '10/20 15:42', text: '地下室顶板做法调整，附设计变更图与现场签认单，工程量按实计量。' },
  { id: 3, author: '周工', role: '商务经理', date: '10/20 14:26', text: '申报金额为含税价，结算时按实际发生金额调整，不重复计入成本。' },
];

export default function CasePreviewPage() {
  const navigate = useNavigate();
  const [notes, setNotes] = useState(initialNotes);
  const [draft, setDraft] = useState('');
  const [sealed, setSealed] = useState(false);

  function addNote(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setNotes((current) => [...current, { id: Date.now(), author: '现场经办', role: '补充批注', date: '刚刚', text }]);
    setDraft('');
  }

  return <div className="page-wrap case-preview">
    <PageHeader
      eyebrow="CHANGES / CASE PREVIEW"
      title="变更签证 · 案卷预览"
      subtitle="记录变更依据、金额影响、外部确认与会签意见；批注不改变台账，落印后才进入归档。"
      actions={<>
        <Button variant="secondary" onClick={() => navigate('/cost/changes')}><ArrowLeft size={15} />返回变更签证</Button>
        <Button variant={sealed ? 'secondary' : 'primary'} onClick={() => setSealed((value) => !value)}><Stamp size={15} />{sealed ? '已落印 · 撤销' : '落印确认'}</Button>
      </>}
    />

    <div className="case-meta">
      <span>案卷 BG-2026-001</span>
      <span>主合同 HT-DEMO-001</span>
      <span>经办 王工</span>
      <span>复核 李工</span>
      <span>2026-10-20</span>
    </div>

    <header className="case-head">
      <div>
        <span className="case-kicker">工程变更 / ENGINEERING CHANGE</span>
        <h2>地下室局部优化</h2>
        <p>增加合同额 · 工程变更 · 外部确认待登记</p>
      </div>
      <div className="case-head-amount">
        <span>本次申报金额</span>
        <strong>{formatMoney(380000, 0)}</strong>
        <small>占主合同 3.0% · 含税</small>
      </div>
    </header>

    <section className="case-summary" aria-label="变更金额摘要">
      <div><span>当前有效合同额</span><strong>¥12,580,000</strong><small>主合同 HT-DEMO-001</small></div>
      <div><span>本次申报</span><strong>¥380,000</strong><div className="case-scale" aria-hidden="true"><span>3.0%</span></div></div>
      <div><span>已确认金额</span><strong>¥0</strong><small>外部确认未登记</small></div>
      <div><span>待确认金额</span><strong>¥380,000</strong><small>审批中 · 不并入生效合同额</small></div>
    </section>

    <div className="case-body">
      <section className="case-doc">
        <div className="case-section-head"><h3>变更说明</h3><span>01 / 03</span></div>
        <p>原设计地下室顶板采用常规梁板体系，现场开挖后局部岩层标高与地勘报告不一致。为避让岩层并保证净高，将 A-01 主楼北侧约 420㎡ 范围调整为局部无梁楼盖，增加钢筋与混凝土用量，不改变建筑功能和总工期。</p>
        <p>本次申报为施工图调整引起的工程变更，已取得设计院补充图、监理现场签认和业主口头确认。外部确认凭证尚未登记，当前仅作为待确认变更展示，不并入有效合同额。</p>

        <div className="case-facts">
          <div><span>发生日期</span><strong>2026-10-18</strong></div>
          <div><span>变更方向</span><strong>增加合同额</strong></div>
          <div><span>关联清单</span><strong>010502 · 地下室结构</strong></div>
          <div><span>外部依据</span><strong>设计变更图 / 现场签认</strong></div>
        </div>

        <table className="case-lines">
          <thead><tr><th>项目</th><th>说明</th><th className="num">金额（元）</th></tr></thead>
          <tbody>
            <tr><td>原合同额</td><td>主合同 HT-DEMO-001</td><td className="num">12,580,000</td></tr>
            <tr><td>本次变更</td><td>地下室局部无梁楼盖</td><td className="num">380,000</td></tr>
            <tr className="is-total"><td>调整后合同额</td><td>待外部确认后生效</td><td className="num">12,960,000</td></tr>
          </tbody>
        </table>

        <div className="case-attachments">
          <a href="#attachment-1"><Paperclip size={13} />设计变更图-A01-北侧顶板.pdf<span>2.4 MB</span></a>
          <a href="#attachment-2"><FileText size={13} />现场签认单-2026-10-18.pdf<span>860 KB</span></a>
        </div>
      </section>

      <aside className="case-notes" aria-label="批注">
        <div className="case-notes-head"><h3>批注 <span>{notes.length} 则</span></h3><span className="case-note-author">会签栏</span></div>
        {notes.map((note) => <article className="case-note" key={note.id}>
          <div className="case-note-meta"><strong>{note.author} · {note.role}</strong><span>{note.date}</span></div>
          <p>{note.text}</p>
        </article>)}
        <form className="case-note-form" onSubmit={addNote}>
          <label htmlFor="case-note-input">补一条批注</label>
          <textarea id="case-note-input" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="写下核验依据或处理意见…" maxLength={240} />
          <button type="submit">写入批注 <Check size={12} /></button>
        </form>
      </aside>
    </div>

    <section className="case-signoff" aria-label="会签栏">
      <div><span>经办</span><strong>王工 · 成本经办</strong><small>2026-10-20</small></div>
      <div><span>复核</span><strong>李工 · 项目复核</strong><small>2026-10-20</small></div>
      <div><span>批准</span><strong>{sealed ? '周工 · 商务经理' : '待批准'}</strong><small>{sealed ? '2026-10-20' : '—'}</small></div>
      <div className={`case-seal ${sealed ? 'is-stamped' : ''}`} aria-live="polite">{sealed ? '已落印' : '待落印'}</div>
    </section>
    <footer className="case-foot">
      <span>V7 案卷预览 · 数字、批注、落印分层，不写回业务台账</span>
      <span>案卷号 BG-2026-001 · 第 1 页 / 共 1 页</span>
    </footer>
  </div>;
}
